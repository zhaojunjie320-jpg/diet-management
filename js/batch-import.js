/**
 * 批量导入：扫描 截图/ 目录、识别、按日期组织
 * 依赖：在 http://localhost:8787/ 通过 proxy/server.js 启动才有 /api/screenshots
 */
window.BatchImport = (function () {

  /**
   * 检测当前是否在「服务器模式」下运行 + 列出 截图/ 目录
   * @returns {Promise<{available: boolean, files: Array, error: string?}>}
   */
  async function discover() {
    try {
      const resp = await fetch('/api/screenshots', { method: 'GET' });
      if (!resp.ok) return { available: false, files: [], error: 'HTTP ' + resp.status };
      const data = await resp.json();
      return { available: true, files: data.files || [], error: data.error || null };
    } catch (e) {
      // 通常是 file:// 直接打开，无法 fetch 相对 URL
      return { available: false, files: [], error: String(e.message || e) };
    }
  }

  /** 从一组已保存 meals 抽出 sourceFile + imageHash 双键去重集合 */
  function dedupeKeys(meals) {
    return Storage.buildDedupeKeys(meals);
  }

  /** 兼容旧调用名 */
  function importedSet(meals) {
    return Storage.buildDedupeKeys(meals).sources;
  }

  /** 按文件名里嵌的日期 + 修改时间，构造截图的 "理论用餐时间" */
  function inferTimestampFromFile(fileInfo) {
    // 文件名形如 Screenshot_2026-05-18-18-26-16-817_xxx.jpg
    // 数字依次是 yyyy-mm-dd-HH-MM-SS-MS
    const m = fileInfo.name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      return new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString();
    }
    if (fileInfo.mtime) return fileInfo.mtime;
    return new Date().toISOString();
  }

  /**
   * 下载并识别单张截图，返回未保存的 meal（不含 aiReview）
   * @param {object} fileInfo  { name, url, dateFromName, ... }
   * @param {object} apiKeys
   * @param {object} profile
   */
  async function importOne(fileInfo, apiKeys, profile, opts = {}) {
    const onStatus = opts.onStatus || (() => {});
    const dedupe = opts.dedupe;  // { sources: Set, hashes: Set }

    onStatus(`下载 ${fileInfo.name}`);
    const resp = await fetch(fileInfo.url);
    if (!resp.ok) throw new Error(`下载图片失败：HTTP ${resp.status}`);
    const blob = await resp.blob();

    // 内容哈希去重
    const imageHash = await Storage.hashBlob(blob);
    if (dedupe && imageHash && dedupe.hashes.has(imageHash)) {
      const err = new Error('重复内容（已有相同图片）');
      err.code = 'DUPLICATE';
      throw err;
    }

    onStatus(`识别 ${fileInfo.name}`);
    const parsed = await AIVision.recognizeBill(blob, apiKeys);

    onStatus(`匹配营养表 ${fileInfo.name}`);
    const items = parsed.items.map(NutritionDB.computeItemNutrition);

    // 兜底估算
    const unmatched = items.filter(i => i.matchSource === 'none' && i.grams > 0);
    for (const item of unmatched) {
      try {
        onStatus(`AI 估算 ${item.name}`);
        const est = await AIVision.estimateNutrition(item.name, item.grams, apiKeys);
        item.nutrition = est;
        item.matchSource = 'ai';
        item.matchedFood = '(AI 估算)';
        item.isVeg = !!est._isVeg;
      } catch (e) { console.warn('估算失败', item.name, e); }
    }

    const { totals, totalPrice } = NutritionDB.computeMealNutrition(items);
    totals.vegG = items.reduce((s, it) => s + (it.isVeg ? (it.grams || 0) : 0), 0);

    // 优先用识别出的下单时间（这才是吃饭的时间）；其次才用文件名里的拍照时间
    const timestamp = parsed.orderTime
      || inferTimestampFromFile(fileInfo)
      || new Date().toISOString();

    // 保存原图
    const imageRef = await Storage.saveImageBlob(blob);

    // 评估异常（使用空 dailyTotals，因为这里不知道完整上下文；后续显示时再算）
    const alerts = Alerts.evaluateMeal(totals, { calories: 0 }, profile);

    return {
      id: Storage.uuid(),
      timestamp,
      mealType: Targets.inferMealType(timestamp),
      restaurant: parsed.restaurant || '',
      items,
      totals,
      totalPrice: parsed.paidTotal || totalPrice,
      alerts,
      aiReview: null,
      imageRef,
      imageHash,
      rawAiResponse: parsed._raw,
      sourceFile: fileInfo.name,
    };
  }

  /**
   * 批量导入：跑完所有待导入文件，挨个回调 onProgress
   * @returns {Promise<{ok: number, fail: number, dates: Set<string>}>}
   */
  async function importAll(files, apiKeys, profile, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    const onItemDone = opts.onItemDone || (() => {});
    const onItemFail = opts.onItemFail || (() => {});
    const dates = new Set();
    let ok = 0, fail = 0, skipped = 0;

    // 拉一次最新的去重键（用户可能已经手动导入过其中一些）
    const existingMeals = await Storage.listAllMeals();
    const dedupe = Storage.buildDedupeKeys(existingMeals);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      onProgress({ index: i, total: files.length, file: f });

      // sourceFile 级别先快过滤
      if (dedupe.sources.has(f.name)) {
        skipped++;
        onItemFail(f, Object.assign(new Error('已导入过同名截图'), { code: 'DUPLICATE' }));
        continue;
      }

      try {
        const meal = await importOne(f, apiKeys, profile, {
          dedupe,
          onStatus: (s) => onProgress({ index: i, total: files.length, file: f, status: s }),
        });
        await Storage.saveMeal(meal);
        // 把新键加进去重集合，避免本批次后续重复
        if (meal.sourceFile) dedupe.sources.add(meal.sourceFile);
        if (meal.imageHash)  dedupe.hashes.add(meal.imageHash);
        ok++;
        dates.add(meal.timestamp.slice(0, 10));
        onItemDone(f, meal);
      } catch (e) {
        if (e && e.code === 'DUPLICATE') skipped++;
        else fail++;
        console.warn('跳过/失败', f.name, e.message || e);
        onItemFail(f, e);
      }
    }
    return { ok, fail, skipped, dates };
  }

  /**
   * 为指定日期补默认早餐（如果当天还没有早餐）
   * @returns {Promise<number>} 实际新增条数
   */
  async function fillDefaultBreakfasts(dates, profile) {
    if (!profile.defaultBreakfast || !profile.defaultBreakfast.enabled) return 0;
    const all = await Storage.listAllMeals();
    // 按日期 → 已有的 breakfast
    const haveBreakfast = new Set();
    all.forEach(m => {
      if (m.mealType === 'breakfast') {
        haveBreakfast.add(m.timestamp.slice(0, 10));
      }
    });
    let count = 0;
    for (const date of dates) {
      if (haveBreakfast.has(date)) continue;
      const meal = Targets.buildDefaultBreakfastMeal(date, profile);
      await Storage.saveMeal(meal);
      count++;
    }
    return count;
  }

  return {
    discover, importedSet, importOne, importAll,
    fillDefaultBreakfasts, inferTimestampFromFile,
  };
})();
