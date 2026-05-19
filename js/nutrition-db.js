/**
 * 食物匹配 + 营养计算
 *  - lookupFood(name)：尝试精确 → 别名 → 模糊关键词；返回 {record, source}
 *  - computeItemNutrition(item)：基于克重计算单项营养
 *  - computeMealNutrition(items)：聚合一餐总营养
 */
window.NutritionDB = (function () {
  const DB = window.FOOD_DB;
  const INDEX = window.FOOD_INDEX;

  // 烹饪/修饰词，匹配前剥离
  const STRIP_TOKENS = [
    '特价菜', '招牌菜', '推荐', '招牌', '特价', '今日特价',
    '（特价菜）', '(特价菜)', '（特价）', '(特价)',
    '一份', '半份', '小份', '大份', '中份',
  ];
  // 烹饪方式：影响后面的修正系数（也用于打 tag，但匹配时不剥离核心）
  const COOK_METHODS = ['炒', '炖', '烤', '煎', '炸', '蒸', '煮', '焖', '烧', '卤', '凉拌', '红烧', '糖醋', '清蒸', '水煮'];

  function cleanName(name) {
    let s = String(name || '').trim();
    STRIP_TOKENS.forEach(t => { s = s.split(t).join(''); });
    s = s.replace(/[（(].*?[)）]/g, '').trim(); // 去括号内容
    return s;
  }

  /** 烹饪修正系数（成品 / 生鲜 营养比） */
  function cookFactor(name) {
    if (/炸|油炸/.test(name)) return 1.30;
    if (/烤|烧烤|烤制/.test(name)) return 1.10;
    if (/炒|爆炒|爆/.test(name)) return 1.08;
    if (/煎/.test(name)) return 1.15;
    if (/红烧|焖|卤/.test(name)) return 1.10;
    if (/炖|煲|清蒸|蒸/.test(name)) return 1.00;
    if (/煮|凉拌/.test(name)) return 0.98;
    return 1.00;
  }

  function lookupFood(rawName) {
    const original = String(rawName || '').trim();
    if (!original) return { record: null, source: 'none' };

    // 1) 精确（含原文）
    if (INDEX.has(original)) return { record: INDEX.get(original), source: 'exact' };

    const cleaned = cleanName(original);
    // 2) 清洗后精确
    if (cleaned && INDEX.has(cleaned)) return { record: INDEX.get(cleaned), source: 'exact' };

    // 3) 别名 substring 命中（任意菜名包含食材关键词，例：「红烧排骨」包含「排骨」）
    let best = null, bestLen = 0;
    for (const f of DB) {
      const candidates = [f.name, ...(f.aliases || [])];
      for (const c of candidates) {
        if (!c) continue;
        if (cleaned.includes(c) || original.includes(c)) {
          if (c.length > bestLen) { best = f; bestLen = c.length; }
        }
      }
    }
    if (best) return { record: best, source: 'alias' };

    // 4) 反向：食材名包含菜名（少见，比如菜名是个短主关键词）
    for (const f of DB) {
      if (cleaned && (f.name.includes(cleaned) || (f.aliases || []).some(a => a.includes(cleaned)))) {
        return { record: f, source: 'fuzzy' };
      }
    }

    return { record: null, source: 'none' };
  }

  const NUTRI_KEYS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium', 'calcium', 'iron', 'vitaminA', 'vitaminC'];

  function emptyNutri() {
    const o = {};
    NUTRI_KEYS.forEach(k => o[k] = 0);
    return o;
  }

  function scaleNutri(record, grams, factor = 1) {
    const out = {};
    const ratio = (grams || 0) / 100 * (factor || 1);
    NUTRI_KEYS.forEach(k => out[k] = (record[k] || 0) * ratio);
    return out;
  }

  /** 给一个识别条目（{name, grams, price}）计算营养，匹配失败时返回 record=null */
  function computeItemNutrition(item) {
    const { record, source } = lookupFood(item.name);
    if (!record) {
      return {
        ...item,
        matchedFood: null,
        matchSource: 'none',
        nutrition: emptyNutri(),
        isVeg: false,
      };
    }
    const factor = cookFactor(item.name);
    const nutrition = scaleNutri(record, item.grams, factor);
    return {
      ...item,
      matchedFood: record.name,
      matchSource: source,
      nutrition,
      isVeg: !!record.isVeg,
    };
  }

  /** 聚合一餐 */
  function computeMealNutrition(items) {
    const totals = emptyNutri();
    totals.vegG = 0;
    let totalPrice = 0;
    items.forEach(it => {
      NUTRI_KEYS.forEach(k => totals[k] += (it.nutrition[k] || 0));
      if (it.isVeg) totals.vegG += it.grams || 0;
      totalPrice += it.price || 0;
    });
    return { totals, totalPrice };
  }

  function isMatched(item) {
    return item.matchSource && item.matchSource !== 'none';
  }

  return {
    lookupFood, cleanName, cookFactor,
    computeItemNutrition, computeMealNutrition,
    emptyNutri, isMatched, NUTRI_KEYS,
  };
})();
