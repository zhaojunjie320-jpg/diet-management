/**
 * TDEE / BMR / 宏量营养素目标计算
 * 公式：Mifflin-St Jeor 估 BMR；活动系数 × BMR = TDEE；目标根据减脂/维持/增肌调整。
 * 宏量推荐：参考中国居民膳食指南
 *   蛋白质 1.2-1.6 g/kg 体重（减脂偏高、维持中、增肌也偏高但热量更高）
 *   脂肪供能比 25-30%
 *   碳水补足
 */
window.Targets = (function () {

  const ACTIVITY_LEVELS = [
    { value: 'sedentary',  factor: 1.2,   label: '久坐',     desc: '办公室、几乎不运动' },
    { value: 'light',      factor: 1.375, label: '轻度活动', desc: '每周 1-3 次轻量运动 / 通勤步行' },
    { value: 'moderate',   factor: 1.55,  label: '中度活动', desc: '每周 3-5 次中等强度运动' },
    { value: 'active',     factor: 1.725, label: '高度活动', desc: '每周 6-7 次较高强度运动' },
    { value: 'veryActive', factor: 1.9,   label: '极度活动', desc: '体力劳动、每日训练' },
  ];

  const GOALS = [
    { value: 'lose',     label: '减脂',  desc: 'TDEE 减约 15%，蛋白质拉高',  caloriesAdj: -0.15, proteinPerKg: 1.6 },
    { value: 'maintain', label: '维持',  desc: '匹配 TDEE，营养均衡',         caloriesAdj: 0,     proteinPerKg: 1.2 },
    { value: 'gain',     label: '增肌',  desc: 'TDEE 加约 10%，蛋白质拉高',  caloriesAdj: 0.10,  proteinPerKg: 1.6 },
  ];

  function calcBMR(profile) {
    // Mifflin-St Jeor
    const { gender, weight, height, age } = profile;
    let bmr = 10 * weight + 6.25 * height - 5 * age;
    bmr += (gender === 'male') ? 5 : -161;
    return Math.round(bmr);
  }

  function calcTDEE(profile) {
    const bmr = calcBMR(profile);
    const lvl = ACTIVITY_LEVELS.find(l => l.value === profile.activityLevel) || ACTIVITY_LEVELS[1];
    return Math.round(bmr * lvl.factor);
  }

  function recommendMacros(profile) {
    const tdee = calcTDEE(profile);
    const goal = GOALS.find(g => g.value === profile.goal) || GOALS[1];
    const targetCalories = Math.round(tdee * (1 + goal.caloriesAdj));
    const protein = Math.round(goal.proteinPerKg * profile.weight);          // g
    const fat = Math.round(targetCalories * 0.27 / 9);                       // 27% 供能
    const proteinKcal = protein * 4;
    const fatKcal = fat * 9;
    const carbs = Math.max(0, Math.round((targetCalories - proteinKcal - fatKcal) / 4));
    return { targetCalories, targetMacros: { protein, fat, carbs } };
  }

  /** 把不完整的 profile 补成完整的 profile（计算 bmr/tdee/target...） */
  function finalize(rawProfile) {
    const p = { ...rawProfile };
    p.bmr = calcBMR(p);
    p.tdee = calcTDEE(p);
    const { targetCalories, targetMacros } = recommendMacros(p);
    p.targetCalories = targetCalories;
    p.targetMacros = targetMacros;
    p.alerts = Object.assign({
      sodiumMaxMg: 2000,   // 单餐钠上限（全日 ~5000mg 的 40%）
      vegMinG: 300,        // 每日蔬菜下限
      fatRatioMax: 35,     // 脂肪供能比上限（%）
    }, p.alerts || {});
    p.defaultBreakfast = Object.assign({}, DEFAULT_BREAKFAST, p.defaultBreakfast || {});
    if (!p.defaultBreakfast.items || !p.defaultBreakfast.items.length) {
      p.defaultBreakfast.items = DEFAULT_BREAKFAST.items.slice();
    }
    return p;
  }

  /** 计算单餐总营养相对当日剩余目标的占用 */
  function mealVsTarget(mealTotals, profile) {
    return {
      calories: { value: mealTotals.calories, pct: pct(mealTotals.calories, profile.targetCalories) },
      protein:  { value: mealTotals.protein,  pct: pct(mealTotals.protein,  profile.targetMacros.protein) },
      fat:      { value: mealTotals.fat,      pct: pct(mealTotals.fat,      profile.targetMacros.fat) },
      carbs:    { value: mealTotals.carbs,    pct: pct(mealTotals.carbs,    profile.targetMacros.carbs) },
    };
  }

  function pct(v, target) {
    return target > 0 ? Math.round(v / target * 100) : 0;
  }

  /** 把一组 meals 的 totals 累加 */
  function sumMeals(meals) {
    const s = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sodium: 0, vegG: 0, price: 0 };
    meals.forEach(m => {
      for (const k in s) {
        if (k === 'price') s.price += m.totalPrice || 0;
        else s[k] += (m.totals && m.totals[k]) || 0;
      }
    });
    return s;
  }

  /**
   * 推断餐次类型（按用餐小时）
   *   早餐 breakfast  05:00 - 10:00
   *   中餐 lunch      10:00 - 16:00
   *   晚餐 dinner     16:00 - 22:00
   *   夜宵 midnight   22:00 - 次日 05:00
   */
  function inferMealType(timestamp) {
    const h = new Date(timestamp).getHours();
    if (h >= 5  && h < 10) return 'breakfast';
    if (h >= 10 && h < 16) return 'lunch';
    if (h >= 16 && h < 22) return 'dinner';
    return 'midnight';
  }

  /** 默认早餐模板 */
  const DEFAULT_BREAKFAST = {
    enabled: true,
    hour: 7, minute: 30,
    items: [
      { name: '牛奶',  grams: 400 },
      { name: '鸡蛋',  grams: 100 },  // 约 2 个
      { name: '燕麦',  grams: 50 },
    ],
  };

  /**
   * 基于模板构造一顿早餐（计算营养、生成 meal 记录，不入库）
   * @param {string} dateStr  YYYY-MM-DD
   * @param {object} profile  含 defaultBreakfast 模板
   */
  function buildDefaultBreakfastMeal(dateStr, profile) {
    const tpl = (profile && profile.defaultBreakfast) || DEFAULT_BREAKFAST;
    const d = new Date(dateStr + 'T00:00:00');
    d.setHours(tpl.hour || 7, tpl.minute || 30, 0, 0);

    const items = tpl.items.map(it => window.NutritionDB.computeItemNutrition({
      name: it.name, grams: it.grams, price: 0,
    }));
    const { totals, totalPrice } = window.NutritionDB.computeMealNutrition(items);
    totals.vegG = items.reduce((s, it) => s + (it.isVeg ? (it.grams || 0) : 0), 0);

    return {
      id: 'm-bf-' + dateStr + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: d.toISOString(),
      mealType: 'breakfast',
      restaurant: '在家',
      items,
      totals,
      totalPrice,
      alerts: [],
      aiReview: null,
      imageRef: null,
      sourceFile: '__default_breakfast__:' + dateStr,
      isDefaultBreakfast: true,
    };
  }

  return {
    ACTIVITY_LEVELS, GOALS, DEFAULT_BREAKFAST,
    calcBMR, calcTDEE, recommendMacros, finalize,
    mealVsTarget, sumMeals, inferMealType,
    buildDefaultBreakfastMeal,
  };
})();
