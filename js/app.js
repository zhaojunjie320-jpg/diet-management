/**
 * 主应用：Vue 3 全局构建
 */
(function () {
  const { createApp, reactive, computed, watch, nextTick, onMounted } = Vue;

  const app = createApp({
    setup() {
      // ------------- 状态 -------------
      const tab = Vue.ref('today');
      const todayLabel = new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' });

      const showOnboarding = Vue.ref(false);
      const onbStep = Vue.ref(1);
      const draftProfile = reactive({
        gender: 'male', age: 25, height: 175, weight: 70,
        activityLevel: 'light', goal: 'maintain',
      });
      const draftApiKeys = reactive({
        vision: '', visionBaseUrl: '', visionModel: 'gemini-2.5-flash', deepseek: '',
      });
      // 用默认配置预填（来自 data/config.local.js 如果存在）
      if (window.__DEFAULT_CONFIG__) {
        Object.assign(draftApiKeys, window.__DEFAULT_CONFIG__);
      }

      const profile = reactive(emptyProfile());
      const apiKeys = reactive(Storage.getApiKeys());

      const meals = Vue.ref([]);        // 所有 meal 列表
      const pendingMeal = Vue.ref(null); // 当前识别但未保存
      const visionBusy = Vue.ref(false);
      const visionStatus = Vue.ref('');
      const coachBusy = Vue.ref(false);
      const dragOver = Vue.ref(false);

      const trendRange = Vue.ref(7);

      const viewingMeal = Vue.ref(null);
      const detailCoachBusy = Vue.ref(false);

      // 餐厅名内联编辑
      const editingNameId = Vue.ref(null);
      const editingNameValue = Vue.ref('');

      // 分享卡
      const showShare = Vue.ref(false);
      const shareBusy = Vue.ref(false);
      const shareCardEl = Vue.ref(null);
      const shareMode = Vue.ref('today');           // 'today' | 'meal'
      const shareTargetMeal = Vue.ref(null);        // 单餐模式下的目标 meal

      // 批量导入状态
      const importer = reactive({
        available: false,
        files: [],
        byDate: [],
        importedCount: 0,
        pendingCount: 0,
        running: false,
        progress: { index: 0, total: 0, status: '' },
        fillBreakfast: true,
        lastResult: null,
      });

      const toastMsg = Vue.ref('');
      const toastLevel = Vue.ref('info');
      function toast(msg, level = 'info', ms = 2500) {
        toastMsg.value = msg; toastLevel.value = level;
        setTimeout(() => { toastMsg.value = ''; }, ms);
      }

      // 选项常量
      const activityLevels = Targets.ACTIVITY_LEVELS;
      const goals = Targets.GOALS;

      // ------------- 计算属性 -------------
      const previewProfile = computed(() => {
        try { return Targets.finalize({ ...draftProfile, alerts: profile.alerts }); }
        catch (e) { return null; }
      });

      const canNextOnb = computed(() => {
        if (onbStep.value === 1) {
          return draftProfile.age > 0 && draftProfile.height > 0 && draftProfile.weight > 0;
        }
        if (onbStep.value === 2) return !!draftProfile.activityLevel;
        if (onbStep.value === 3) return !!draftProfile.goal;
        return true;
      });

      const todayMeals = computed(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const end = start + 86400000;
        return meals.value
          .filter(m => {
            const t = new Date(m.timestamp).getTime();
            return t >= start && t < end;
          })
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      });

      const todayTotals = computed(() => Targets.sumMeals(todayMeals.value));

      const macroRows = computed(() => {
        const t = todayTotals.value;
        const tgt = profile.targetMacros || { protein: 0, fat: 0, carbs: 0 };
        return [
          row('热量', 'cal',     t.calories, profile.targetCalories, 'kcal'),
          row('蛋白', 'protein', t.protein,  tgt.protein, 'g'),
          row('脂肪', 'fat',     t.fat,      tgt.fat,     'g'),
          row('碳水', 'carbs',   t.carbs,    tgt.carbs,   'g'),
        ];
      });
      function row(label, key, value, target, unit) {
        const v = Math.round(value || 0);
        const tg = target || 1;
        const pct = Math.min(100, Math.round(v / tg * 100));
        return { label, key, value: v, target: tg, unit, pct, cls: pct >= 100 ? 'over' : '' };
      }

      /** 炸弹/拆弹状态徽章（每项营养） */
      const todayBadges = computed(() => {
        const t = todayTotals.value;
        const tgt = profile.targetMacros || { protein: 0, fat: 0, carbs: 0 };
        // 蛋白过量基本无害，不用 bomb；碳水/脂肪/热量过量才是炸弹
        function makeBadge(key, label, val, target, unit, conf) {
          const pct = target > 0 ? Math.round(val / target * 100) : 0;
          let state, emoji, tag;
          if (pct > 110)      { state = 'bomb'; emoji = conf.bomb;  tag = conf.bombTag; }
          else if (pct > 100) { state = 'over'; emoji = conf.over;  tag = conf.overTag; }
          else if (pct >= 80) { state = 'near'; emoji = conf.near;  tag = conf.nearTag; }
          else                { state = 'safe'; emoji = conf.safe;  tag = conf.safeTag; }
          return { key, label, value: Math.round(val || 0), target, unit, pct, state, emoji, tag };
        }
        return [
          makeBadge('cal',     '热量', t.calories, profile.targetCalories, 'kcal',
            { safe:'🛡️',  safeTag:'安全',   near:'🎯', nearTag:'临界',
              over:'🧨',  overTag:'导火索', bomb:'💥', bombTag:'爆了' }),
          makeBadge('protein', '蛋白', t.protein,  tgt.protein, 'g',
            { safe:'🥚',  safeTag:'尚可',   near:'💪', nearTag:'达标',
              over:'💪',  overTag:'肌肉合成', bomb:'💪', bombTag:'蛋白王' }),
          makeBadge('fat',     '脂肪', t.fat,      tgt.fat,     'g',
            { safe:'🛡️',  safeTag:'安全',   near:'🎯', nearTag:'临界',
              over:'🧈',  overTag:'油超线', bomb:'🥓', bombTag:'油爆' }),
          makeBadge('carbs',   '碳水', t.carbs,    tgt.carbs,   'g',
            { safe:'🍚',  safeTag:'安全',   near:'🎯', nearTag:'临界',
              over:'🧨',  overTag:'导火索', bomb:'💣', bombTag:'碳水炸弹' }),
        ];
      });

      /** 整体英雄状态（拆弹/被炸） */
      const heroStatus = computed(() => {
        const t = todayTotals.value;
        const cal = t.calories || 0;
        const calTgt = profile.targetCalories || 0;
        if (!calTgt) return { emoji: '🧑‍🚒', title: '拆弹专家待命', sub: '设个目标先', cls: 'safe' };

        const bombs = todayBadges.value.filter(b => b.state === 'bomb' && b.key !== 'protein');
        const overs = todayBadges.value.filter(b => b.state === 'over' && b.key !== 'protein');

        if (bombs.length) {
          const which = bombs.map(b => b.label).join('+');
          return {
            emoji: '💥', cls: 'bombed',
            title: `被${which}炸弹炸了`,
            sub: `多吃了 ${Math.round(cal - calTgt)} kcal，明天补回来`,
          };
        }
        if (overs.length) {
          return {
            emoji: '🧨', cls: 'warn',
            title: '导火索冒烟了',
            sub: `${overs.map(o => o.label).join('、')}刚好超线，关掉外卖小程序`,
          };
        }
        if (cal > calTgt * 0.9) {
          return {
            emoji: '⚠️', cls: 'near',
            title: '逼近警戒线',
            sub: `还剩 ${Math.round(calTgt - cal)} kcal 才会爆炸`,
          };
        }
        if (cal > calTgt * 0.4) {
          return {
            emoji: '🧑‍🚒', cls: 'safe',
            title: '拆弹专家在线',
            sub: `已稳妥拆除 ${Math.round(cal / calTgt * 100)}% 任务`,
          };
        }
        if (cal > 0) {
          return {
            emoji: '🛡️', cls: 'safe',
            title: '保险拉好了',
            sub: `今日预算还有 ${Math.round(calTgt - cal)} kcal`,
          };
        }
        return {
          emoji: '☕', cls: 'idle',
          title: '今天还没记账',
          sub: '拖入截图或补一份默认早餐就能开局',
        };
      });

      function goalLabel(g) {
        return ({ lose: '减脂', maintain: '维持', gain: '增肌' })[g] || g;
      }

      // ============ 分享卡相关 ============
      const shareDateLabel = computed(() => {
        const d = new Date();
        return `${d.getMonth() + 1}月${d.getDate()}日`;
      });

      /** 海报里只显示前 4 餐（再多就溢出了） */
      const shareMealsForCard = computed(() => {
        return todayMeals.value.slice(0, 4).reverse();  // 时间正序
      });

      /** 从今日餐里取一句 AI 建议，没有就 fallback */
      const shareAiTip = computed(() => {
        for (let i = todayMeals.value.length - 1; i >= 0; i--) {
          const r = todayMeals.value[i].aiReview;
          if (r && r.suggestions && r.suggestions[0]) return r.suggestions[0];
        }
        const fb = {
          bombed: '炸弹已引爆，明天换轻食组合',
          warn:   '导火索冒烟了，下一餐少油少米',
          near:   '剩余预算不多，留点空给晚餐',
          safe:   '节奏稳，继续保持',
          idle:   '今日还没记账，先吃一顿再说',
        };
        return fb[heroStatus.value.cls] || '关注营养结构，少看体重秤';
      });

      function openShare(mode = 'today', meal = null) {
        shareMode.value = mode;
        shareTargetMeal.value = meal;
        showShare.value = true;
      }

      function shareMeal(m) {
        openShare('meal', m);
      }

      function switchShareMode(mode) {
        shareMode.value = mode;
        if (mode === 'meal' && !shareTargetMeal.value) {
          // 默认选今日的第一餐（按时间正序，挑最大热量的那个最有传播力）
          const candidates = [...todayMeals.value].sort((a, b) => b.totals.calories - a.totals.calories);
          shareTargetMeal.value = candidates[0] || null;
        }
      }

      async function downloadShareImage() {
        if (!shareCardEl.value || !window.htmlToImage) {
          toast('图片库还没加载好，请稍等', 'error');
          return;
        }
        shareBusy.value = true;
        try {
          // html-to-image 自动按 pixelRatio 缩放，3 倍 -> 1080×1920
          const dataUrl = await window.htmlToImage.toPng(shareCardEl.value, {
            pixelRatio: 3,
            cacheBust: true,
            backgroundColor: null,
          });
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `饮食管理_${new Date().toISOString().slice(0,10)}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          toast('已下载', 'success');
        } catch (e) {
          console.error(e);
          toast('生成失败：' + (e.message || e), 'error', 4000);
        } finally {
          shareBusy.value = false;
        }
      }

      // 历史按天分组
      const historyByDay = computed(() => {
        const groups = new Map();
        meals.value.forEach(m => {
          const d = new Date(m.timestamp);
          const key = d.toISOString().slice(0, 10);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(m);
        });
        const arr = [];
        for (const [date, list] of groups) {
          list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          arr.push({ date, meals: list, totals: Targets.sumMeals(list) });
        }
        arr.sort((a, b) => b.date.localeCompare(a.date));
        return arr;
      });

      // ------------- 初始化 -------------
      onMounted(async () => {
        const saved = Storage.getProfile();
        if (!saved) {
          showOnboarding.value = true;
        } else {
          // 旧 profile 可能没有 defaultBreakfast 字段，用 finalize 补齐
          Object.assign(profile, Targets.finalize(saved));
          Storage.setProfile(Vue.toRaw(profile));
        }
        await reloadMeals();
        await refreshImporter();
        renderTodayChart();
        watch(todayTotals, () => renderTodayChart(), { deep: true });
        watch(() => tab.value, (v) => {
          if (v === 'trends') nextTick(() => renderTrendCharts());
        });
        // 引导期间修改了 profile 字段，触发 preview 同步
        watch(() => [draftProfile.gender, draftProfile.age, draftProfile.height,
                     draftProfile.weight, draftProfile.activityLevel, draftProfile.goal], () => {});

        // 设置页里改个人信息时实时重算 TDEE
        watch(() => [profile.gender, profile.age, profile.height, profile.weight,
                     profile.activityLevel, profile.goal], () => {
          const f = Targets.finalize({ ...profile });
          profile.bmr = f.bmr; profile.tdee = f.tdee;
          profile.targetCalories = f.targetCalories;
          profile.targetMacros = f.targetMacros;
        });
      });

      function emptyProfile() {
        return {
          gender: 'male', age: 25, height: 175, weight: 70,
          activityLevel: 'light', goal: 'maintain',
          bmr: 0, tdee: 0, targetCalories: 0,
          targetMacros: { protein: 0, fat: 0, carbs: 0 },
          alerts: { sodiumMaxMg: 2000, vegMinG: 300, fatRatioMax: 35 },
        };
      }

      async function reloadMeals() {
        meals.value = await Storage.listAllMeals();
      }

      // ------------- 引导 -------------
      function finishOnboarding() {
        const final = Targets.finalize({ ...draftProfile });
        Object.assign(profile, final);
        Storage.setProfile(final);
        Object.assign(apiKeys, draftApiKeys);
        Storage.setApiKeys(apiKeys);
        showOnboarding.value = false;
        toast('欢迎！请上传一张账单开始记录', 'success');
        nextTick(() => renderTodayChart());
      }

      // ------------- 上传识别 -------------
      function onFilePick(e) {
        const f = e.target.files && e.target.files[0];
        if (f) handleImage(f);
        e.target.value = '';
      }
      function onDrop(e) {
        dragOver.value = false;
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleImage(f);
      }
      async function handleImage(file) {
        if (!apiKeys.vision || !apiKeys.visionBaseUrl) {
          toast('请先在「设置」里填写图像识别 API Key 和接口 URL', 'error');
          return;
        }
        try {
          visionBusy.value = true;
          visionStatus.value = '正在校验图片…';
          // 去重：同一张图（哈希一致）已导入过就不重复识别
          const imageHash = await Storage.hashBlob(file);
          const dedupe = Storage.buildDedupeKeys(meals.value);
          if (imageHash && dedupe.hashes.has(imageHash)) {
            toast('这张图之前已经导入过了', 'info', 3500);
            return;
          }

          visionStatus.value = '正在识别图片…';
          const parsed = await AIVision.recognizeBill(file, apiKeys);

          visionStatus.value = '正在匹配营养表…';
          const items = parsed.items.map(NutritionDB.computeItemNutrition);

          // 兜底：未匹配的项调视觉接口估算
          const unmatched = items.filter(i => i.matchSource === 'none' && i.grams > 0);
          if (unmatched.length) {
            visionStatus.value = `AI 估算 ${unmatched.length} 项营养…`;
            for (const item of unmatched) {
              try {
                const est = await AIVision.estimateNutrition(item.name, item.grams, apiKeys);
                item.nutrition = est;
                item.matchSource = 'ai';
                item.matchedFood = '(AI 估算)';
                item.isVeg = !!est._isVeg;
              } catch (e) { console.warn('估算失败', item.name, e); }
            }
          }

          const { totals, totalPrice } = NutritionDB.computeMealNutrition(items);
          totals.vegG = items.reduce((s, it) => s + (it.isVeg ? (it.grams || 0) : 0), 0);

          const timestamp = parsed.orderTime || new Date().toISOString();
          // 存图
          const imageRef = await Storage.saveImageBlob(file);

          const dailyBefore = Targets.sumMeals(todayMeals.value);
          const totalsForAlert = { ...totals };
          const dailyAfter = {
            calories: dailyBefore.calories + totalsForAlert.calories,
          };
          const alerts = Alerts.evaluateMeal(totalsForAlert, dailyAfter, profile);

          const meal = {
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
          };
          pendingMeal.value = meal;
          await nextTick();
          renderMealRing();

          // 自动发起评价
          refreshReview();
        } catch (e) {
          console.error(e);
          toast(e.message || '识别失败', 'error', 5000);
        } finally {
          visionBusy.value = false;
          visionStatus.value = '';
        }
      }

      async function refreshReview() {
        if (!pendingMeal.value) return;
        const meal = pendingMeal.value;
        try {
          coachBusy.value = true;
          const dailyTotals = Targets.sumMeals([...todayMeals.value, meal]);
          const review = await AICoach.reviewMeal(meal, profile, dailyTotals, apiKeys);
          meal.aiReview = review;
        } catch (e) {
          console.error(e);
          toast('AI 点评失败：' + (e.message || ''), 'error', 4000);
        } finally {
          coachBusy.value = false;
        }
      }

      async function savePending() {
        if (!pendingMeal.value) return;
        await Storage.saveMeal(Vue.toRaw(pendingMeal.value));
        toast('已保存', 'success');
        pendingMeal.value = null;
        await reloadMeals();
        renderTodayChart();
      }

      async function discardPending() {
        if (pendingMeal.value && pendingMeal.value.imageRef) {
          // 把孤儿图片也删了
          try {
            const db = await window.idb.openDB('diet-mgmt');
            await db.delete('images', pendingMeal.value.imageRef);
          } catch (e) {}
        }
        pendingMeal.value = null;
      }

      async function deleteMeal(m) {
        if (!confirm(`删除「${m.restaurant || '未命名'}」?`)) return;
        await Storage.deleteMeal(m.id);
        await reloadMeals();
        renderTodayChart();
      }

      function viewMeal(m) { viewingMeal.value = m; }

      /** 在详情弹窗内为这一餐生成（或重新生成）AI 点评，并把结果保存回 IndexedDB */
      async function generateReviewForViewing() {
        if (!viewingMeal.value) return;
        const meal = viewingMeal.value;
        detailCoachBusy.value = true;
        try {
          // 拿这餐所在日期的全天 totals 作为上下文
          const dayKey = meal.timestamp.slice(0, 10);
          const dayMeals = meals.value.filter(m => m.timestamp.slice(0, 10) === dayKey);
          const dailyTotals = Targets.sumMeals(dayMeals);
          const review = await AICoach.reviewMeal(meal, profile, dailyTotals, apiKeys);
          meal.aiReview = review;
          await Storage.saveMeal(Vue.toRaw(meal));
          // 把内存里的 meals 里同 id 那条也同步一下
          const idx = meals.value.findIndex(m => m.id === meal.id);
          if (idx >= 0) meals.value[idx] = { ...meals.value[idx], aiReview: review };
          toast('已生成 AI 点评', 'success');
        } catch (e) {
          console.error(e);
          toast('生成失败：' + (e.message || e), 'error', 5000);
        } finally {
          detailCoachBusy.value = false;
        }
      }

      // ------------- 批量导入 -------------
      async function refreshImporter() {
        const r = await BatchImport.discover();
        importer.available = r.available;
        if (!r.available) return;

        const importedFiles = BatchImport.importedSet(meals.value);
        const enriched = r.files.map(f => ({
          ...f,
          isImported: importedFiles.has(f.name),
        }));
        importer.files = enriched;
        importer.importedCount = enriched.filter(f => f.isImported).length;
        importer.pendingCount   = enriched.filter(f => !f.isImported).length;

        // 按日期分组
        const byDate = new Map();
        enriched.forEach(f => {
          const d = f.dateFromName || '未知日期';
          if (!byDate.has(d)) byDate.set(d, []);
          byDate.get(d).push(f);
        });
        importer.byDate = Array.from(byDate.entries())
          .map(([date, files]) => ({
            date,
            files,
            importedCount: files.filter(f => f.isImported).length,
          }))
          .sort((a, b) => b.date.localeCompare(a.date));
      }

      const importProgressPct = computed(() => {
        const t = importer.progress.total || 1;
        return Math.round((importer.progress.index + (importer.running ? 0.5 : 1)) / t * 100);
      });

      const defaultBreakfastSummary = computed(() => {
        const items = (profile.defaultBreakfast && profile.defaultBreakfast.items) || [];
        return items.map(it => `${it.grams}g ${it.name}`).join('、') || '默认配置';
      });

      async function runBatchImport() {
        if (!apiKeys.vision || !apiKeys.visionBaseUrl) {
          toast('请先在设置里填写图像识别 API Key + URL', 'error', 4000);
          return;
        }
        const pending = importer.files.filter(f => !f.isImported);
        if (pending.length === 0) return;

        importer.running = true;
        importer.progress = { index: 0, total: pending.length, status: '准备中…' };
        try {
          const result = await BatchImport.importAll(pending, apiKeys, profile, {
            onProgress: (p) => { importer.progress = { ...p, status: p.status || '处理中…' }; },
          });
          let breakfasts = 0;
          if (importer.fillBreakfast) {
            importer.progress = { ...importer.progress, status: '补默认早餐…' };
            breakfasts = await BatchImport.fillDefaultBreakfasts(result.dates, profile);
          }
          importer.lastResult = { ok: result.ok, fail: result.fail, skipped: result.skipped, breakfasts };
          const parts = [`${result.ok} 成功`];
          if (result.skipped) parts.push(`${result.skipped} 重复跳过`);
          if (result.fail)    parts.push(`${result.fail} 失败`);
          if (breakfasts)     parts.push(`补早餐 ${breakfasts} 份`);
          toast('完成：' + parts.join(' / '), 'success', 5000);
        } catch (e) {
          console.error(e);
          toast('导入异常：' + (e.message || e), 'error', 5000);
        } finally {
          importer.running = false;
          await reloadMeals();
          await refreshImporter();
          renderTodayChart();
        }
      }

      async function addBreakfastForToday() {
        const today = new Date().toISOString().slice(0, 10);
        const dates = new Set([today]);
        const n = await BatchImport.fillDefaultBreakfasts(dates, profile);
        if (n > 0) {
          await reloadMeals();
          renderTodayChart();
          toast('已添加今日默认早餐', 'success');
        } else {
          toast('今天已经有早餐了', 'info');
        }
      }

      // ------------- 图表 / 模板 refs -------------
      const todayRingEl = Vue.ref(null);
      const mealRingEl = Vue.ref(null);
      const trendCalEl = Vue.ref(null);
      const trendMacroEl = Vue.ref(null);
      const fileInput = Vue.ref(null);
      function openFilePicker() { if (fileInput.value) fileInput.value.click(); }
      let todayChart = null, mealChart = null, trendCalChart = null, trendMacroChart = null;

      function renderTodayChart() {
        nextTick(() => {
          if (todayChart) todayChart.dispose();
          todayChart = Charts.renderTodayRing(todayRingEl.value, todayTotals.value, profile);
        });
      }
      function renderMealRing() {
        if (mealChart) mealChart.dispose();
        if (!pendingMeal.value) return;
        mealChart = Charts.renderMacroRing(mealRingEl.value, pendingMeal.value.totals, profile);
      }

      function renderTrendCharts() {
        const range = trendRange.value;
        const today = new Date();
        const days = [];
        for (let i = range - 1; i >= 0; i--) {
          const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
          const start = d.getTime(), end = start + 86400000;
          const dayMeals = meals.value.filter(m => {
            const t = new Date(m.timestamp).getTime();
            return t >= start && t < end;
          });
          days.push({
            date: d.toISOString().slice(0, 10),
            dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
            totals: Targets.sumMeals(dayMeals),
          });
        }
        if (trendCalChart) trendCalChart.dispose();
        trendCalChart = Charts.renderCalTrend(trendCalEl.value, days, profile);
        if (trendMacroChart) trendMacroChart.dispose();
        trendMacroChart = Charts.renderMacroTrend(trendMacroEl.value, days);
      }

      // ------------- 设置保存 -------------
      function saveProfile() {
        Storage.setProfile(Vue.toRaw(profile));
        toast('已保存', 'success');
      }
      function saveApiKeys() {
        Storage.setApiKeys(Vue.toRaw(apiKeys));
        toast('已保存', 'success');
      }

      async function exportData() {
        const data = await Storage.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diet-export-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }

      async function clearAll() {
        if (!confirm('确定清空所有用餐记录和图片？此操作不可撤销。')) return;
        await Storage.clearAll();
        await reloadMeals();
        toast('已清空', 'success');
      }

      // ------------- 辅助 -------------
      function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }
      function mealTypeLabel(type) {
        return ({
          breakfast: '早餐',
          lunch:     '中餐',
          dinner:    '晚餐',
          midnight:  '夜宵',
          snack:     '夜宵',  // 兼容历史数据
        }[type]) || '夜宵';
      }
      function matchLabel(src) {
        return ({ exact: '精确', alias: '别名', fuzzy: '模糊', ai: 'AI', none: '未匹配' }[src]) || src;
      }

      /** 列表里要不要显示餐厅名 —— 占位词（在家/未命名/未知）一律隐藏 */
      const PLACEHOLDER_NAMES = new Set(['', '在家', '未命名', '未知', '未知餐厅']);
      function displayRestaurant(meal) {
        if (!meal || !meal.restaurant) return '';
        return PLACEHOLDER_NAMES.has(meal.restaurant.trim()) ? '' : meal.restaurant;
      }

      function startEditName(meal) {
        if (!meal) return;
        editingNameId.value = meal.id;
        editingNameValue.value = displayRestaurant(meal) || '';
        nextTick(() => {
          const el = document.querySelector('.name-edit-input.active');
          if (el) { el.focus(); el.select(); }
        });
      }
      function cancelEditName() {
        editingNameId.value = null;
        editingNameValue.value = '';
      }
      async function saveEditName(meal) {
        if (!meal || editingNameId.value !== meal.id) return;
        const newName = editingNameValue.value.trim();
        const oldName = (meal.restaurant || '').trim();
        if (newName === oldName) { cancelEditName(); return; }

        // 待保存餐：只更新内存
        if (pendingMeal.value && pendingMeal.value.id === meal.id) {
          pendingMeal.value.restaurant = newName;
          cancelEditName();
          return;
        }
        // 已入库：更新内存 + IndexedDB
        const target = meals.value.find(m => m.id === meal.id);
        if (target) {
          target.restaurant = newName;
          await Storage.saveMeal(Vue.toRaw(target));
        }
        if (viewingMeal.value && viewingMeal.value.id === meal.id) {
          viewingMeal.value.restaurant = newName;
        }
        cancelEditName();
        toast('已保存', 'success', 1500);
      }

      return {
        // state
        tab, todayLabel, showOnboarding, onbStep, draftProfile, draftApiKeys,
        profile, apiKeys, meals, pendingMeal, visionBusy, visionStatus, coachBusy,
        dragOver, trendRange, viewingMeal, detailCoachBusy, toastMsg, toastLevel,
        activityLevels, goals, previewProfile, canNextOnb,
        todayMeals, todayTotals, macroRows, todayBadges, heroStatus, historyByDay,
        importer, importProgressPct, defaultBreakfastSummary, goalLabel,
        showShare, shareBusy, shareCardEl, shareDateLabel, shareMealsForCard, shareAiTip,
        shareMode, shareTargetMeal, switchShareMode, shareMeal,
        // refs
        todayRingEl, mealRingEl, trendCalEl, trendMacroEl, fileInput,
        // methods
        openFilePicker,
        finishOnboarding, onFilePick, onDrop, savePending, discardPending,
        refreshReview, deleteMeal, viewMeal, generateReviewForViewing,
        renderTrendCharts, saveProfile, saveApiKeys, exportData, clearAll,
        formatTime, mealTypeLabel, matchLabel, displayRestaurant,
        editingNameId, editingNameValue, startEditName, saveEditName, cancelEditName,
        runBatchImport, addBreakfastForToday, refreshImporter,
        openShare, shareMeal, switchShareMode, downloadShareImage,
      };
    },
  });

  app.mount('#app');
})();
