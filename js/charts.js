/**
 * ECharts 图表封装
 */
window.Charts = (function () {

  const COLORS = {
    protein: '#5b8def',
    fat:     '#f7a13d',
    carbs:   '#4ecdb3',
    target:  '#a0a8b8',
    actual:  '#5b8def',
    over:    '#ef6b6b',
  };

  function renderMacroRing(el, totals, profile) {
    if (!el) return null;
    const chart = echarts.init(el);
    const proteinKcal = (totals.protein || 0) * 4;
    const fatKcal     = (totals.fat || 0) * 9;
    const carbsKcal   = (totals.carbs || 0) * 4;
    const total = proteinKcal + fatKcal + carbsKcal;

    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} kcal ({d}%)' },
      legend: { bottom: 0, textStyle: { fontSize: 12 } },
      series: [{
        type: 'pie',
        radius: ['55%', '78%'],
        avoidLabelOverlap: false,
        label: {
          show: true,
          position: 'center',
          formatter: () => `{a|${Math.round(totals.calories || 0)}}\n{b|kcal}`,
          rich: {
            a: { fontSize: 24, fontWeight: 'bold', color: '#222' },
            b: { fontSize: 12, color: '#888' },
          },
        },
        data: [
          { value: Math.round(proteinKcal), name: '蛋白', itemStyle: { color: COLORS.protein } },
          { value: Math.round(fatKcal),     name: '脂肪', itemStyle: { color: COLORS.fat     } },
          { value: Math.round(carbsKcal),   name: '碳水', itemStyle: { color: COLORS.carbs   } },
        ],
      }],
    });
    return chart;
  }

  function renderTodayRing(el, totals, profile) {
    if (!el) return null;
    const chart = echarts.init(el);
    const target = profile.targetCalories || 2000;
    const remain = Math.max(0, target - totals.calories);
    const over = Math.max(0, totals.calories - target);

    chart.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['62%', '85%'],
        startAngle: 90,
        label: {
          show: true,
          position: 'center',
          formatter: () => `{a|${Math.round(totals.calories)}}\n{b|/ ${target} kcal}`,
          rich: {
            a: { fontSize: 28, fontWeight: 'bold', color: over > 0 ? COLORS.over : '#222' },
            b: { fontSize: 12, color: '#888' },
          },
        },
        data: over > 0
          ? [
              { value: target, name: '目标', itemStyle: { color: COLORS.actual } },
              { value: over,   name: '超出', itemStyle: { color: COLORS.over } },
            ]
          : [
              { value: totals.calories, name: '已摄入', itemStyle: { color: COLORS.actual } },
              { value: remain,          name: '剩余',  itemStyle: { color: '#eef0f4' } },
            ],
      }],
    });
    return chart;
  }

  function renderCalTrend(el, days, profile) {
    if (!el) return null;
    const chart = echarts.init(el);
    chart.setOption({
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: days.map(d => d.dateLabel) },
      yAxis: { type: 'value', name: 'kcal' },
      series: [
        {
          name: '实际摄入',
          type: 'bar',
          data: days.map(d => Math.round(d.totals.calories)),
          itemStyle: {
            color: (p) => p.value > profile.targetCalories ? COLORS.over : COLORS.actual,
          },
          barWidth: '60%',
        },
        {
          name: '每日目标',
          type: 'line',
          data: days.map(_ => profile.targetCalories),
          symbol: 'none',
          lineStyle: { color: COLORS.target, type: 'dashed' },
        },
      ],
    });
    return chart;
  }

  function renderMacroTrend(el, days) {
    if (!el) return null;
    const chart = echarts.init(el);
    chart.setOption({
      grid: { left: 50, right: 20, top: 30, bottom: 50 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      xAxis: { type: 'category', data: days.map(d => d.dateLabel) },
      yAxis: { type: 'value', name: 'g' },
      series: [
        { name: '蛋白', type: 'bar', stack: 'macro', data: days.map(d => Math.round(d.totals.protein)), itemStyle: { color: COLORS.protein } },
        { name: '脂肪', type: 'bar', stack: 'macro', data: days.map(d => Math.round(d.totals.fat)),     itemStyle: { color: COLORS.fat } },
        { name: '碳水', type: 'bar', stack: 'macro', data: days.map(d => Math.round(d.totals.carbs)),   itemStyle: { color: COLORS.carbs } },
      ],
    });
    return chart;
  }

  return { renderMacroRing, renderTodayRing, renderCalTrend, renderMacroTrend };
})();
