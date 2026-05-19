/**
 * 异常营养规则
 * 返回 [{level: 'warn'|'info', code, msg}]
 */
window.Alerts = (function () {

  function evaluateMeal(mealTotals, dailyTotals, profile) {
    const alerts = [];
    const a = profile.alerts || {};

    // 1) 单餐钠超标
    if (mealTotals.sodium && mealTotals.sodium > (a.sodiumMaxMg || 2000)) {
      alerts.push({
        level: 'warn',
        code: 'sodium',
        msg: `钠摄入 ${Math.round(mealTotals.sodium)} mg，超过单餐建议上限 ${a.sodiumMaxMg} mg`,
      });
    }

    // 2) 脂肪供能比偏高
    const fatKcal = (mealTotals.fat || 0) * 9;
    const cal = mealTotals.calories || 0;
    if (cal > 0) {
      const ratio = fatKcal / cal * 100;
      if (ratio > (a.fatRatioMax || 35)) {
        alerts.push({
          level: 'warn',
          code: 'fat-ratio',
          msg: `脂肪供能比 ${ratio.toFixed(0)}%，偏高（建议 <${a.fatRatioMax}%）`,
        });
      }
    }

    // 3) 蛋白质不足（按当日剩余目标的"应得份额"判断）
    if (profile.targetMacros && profile.targetMacros.protein) {
      const expected = profile.targetMacros.protein / 3;  // 假设每餐 1/3
      if ((mealTotals.protein || 0) < expected * 0.6) {
        alerts.push({
          level: 'info',
          code: 'protein-low',
          msg: `这一餐蛋白质偏少（${mealTotals.protein.toFixed(0)}g），建议 ≥${Math.round(expected)}g`,
        });
      }
    }

    // 4) 蔬菜量
    if ((mealTotals.vegG || 0) < 100) {
      alerts.push({
        level: 'info',
        code: 'veg-low',
        msg: `蔬菜量 ${Math.round(mealTotals.vegG)}g，建议每餐 ≥150g`,
      });
    }

    // 5) 累计已经接近 / 超过 当日目标
    if (dailyTotals && profile.targetCalories) {
      const dailyPct = dailyTotals.calories / profile.targetCalories;
      if (dailyPct > 1.10) {
        alerts.push({
          level: 'warn',
          code: 'daily-over',
          msg: `今日累计 ${Math.round(dailyTotals.calories)} kcal，已超过目标 10% 以上`,
        });
      } else if (dailyPct > 0.9 && dailyPct <= 1.10) {
        alerts.push({
          level: 'info',
          code: 'daily-near',
          msg: `今日累计 ${Math.round(dailyTotals.calories)} kcal，接近目标`,
        });
      }
    }

    return alerts;
  }

  return { evaluateMeal };
})();
