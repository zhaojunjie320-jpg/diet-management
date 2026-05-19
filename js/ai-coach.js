/**
 * AI 营养师：根据本餐 + 个人目标，生成评分 / 总结 / 建议
 * 默认用 DeepSeek（经本地代理），如果代理不可用，降级用 Gemini 文本。
 *
 * 返回：{ rating: number (1-10), summary: string, suggestions: string[] }
 */
window.AICoach = (function () {

  const DEEPSEEK_MODEL = 'deepseek-chat';   // 最新对话模型

  function buildPrompt(meal, profile, dailyTotals) {
    const goalLabel = ({ lose: '减脂', maintain: '维持体重', gain: '增肌' })[profile.goal] || '维持';
    const itemsText = meal.items.map(it =>
      `- ${it.name} ${it.grams}g（热量 ${Math.round(it.nutrition.calories)} kcal，蛋白 ${it.nutrition.protein.toFixed(1)}g，脂肪 ${it.nutrition.fat.toFixed(1)}g，碳水 ${it.nutrition.carbs.toFixed(1)}g）`
    ).join('\n');

    return `你是一位严谨、务实的中文营养师。请基于下面这一餐的具体数据，给出营养点评。

# 用户档案
- 性别：${profile.gender === 'male' ? '男' : '女'}，年龄 ${profile.age}，身高 ${profile.height}cm，体重 ${profile.weight}kg
- 目标：${goalLabel}
- 每日目标：${profile.targetCalories} kcal（蛋白 ${profile.targetMacros.protein}g / 脂肪 ${profile.targetMacros.fat}g / 碳水 ${profile.targetMacros.carbs}g）
- 今日累计（含本餐前）：${Math.round(dailyTotals.calories - meal.totals.calories)} kcal

# 本餐
餐厅：${meal.restaurant || '未知'}
${itemsText}

# 本餐合计
- 热量 ${Math.round(meal.totals.calories)} kcal
- 蛋白 ${meal.totals.protein.toFixed(1)}g
- 脂肪 ${meal.totals.fat.toFixed(1)}g
- 碳水 ${meal.totals.carbs.toFixed(1)}g
- 钠 ${Math.round(meal.totals.sodium)} mg
- 蔬菜量 ${Math.round(meal.totals.vegG || 0)} g

请输出严格 JSON（不要 markdown 包裹），结构：
{
  "rating": 1-10 的整数，结合目标、宏量结构、蔬菜量、钠等综合给分,
  "summary": "1-2 句话总结这一餐的特点和最大问题",
  "suggestions": ["建议1（具体可执行）", "建议2", "建议3"]
}

要求：
1. summary 一定要针对具体菜品和具体数值，不要套话。
2. 3 条 suggestions，每条 ≤30 字，针对性强，比如"米饭减半到 130g 左右"而不是"减少主食"。
3. 评分严格：完全偏离目标给 3 分以下；合格 5-6；很好 7-8；接近最优 9-10。`;
  }

  function buildSystemRole() {
    return '你是中文营养师。永远输出严格 JSON，不输出 markdown 包裹、不输出额外文字。';
  }

  /** 主入口：自动选 provider */
  async function reviewMeal(meal, profile, dailyTotals, apiKeys, options = {}) {
    const provider = (apiKeys.coachProvider || 'deepseek');
    try {
      if (provider === 'deepseek') return await callDeepSeek(meal, profile, dailyTotals, apiKeys);
      return await callVisionProvider(meal, profile, dailyTotals, apiKeys);
    } catch (e) {
      console.warn('Coach 主链路失败，尝试 fallback', e);
      // 失败 fallback：DeepSeek 走不通就回退到视觉接口
      if (provider === 'deepseek' && apiKeys.vision && apiKeys.visionBaseUrl) {
        try { return await callVisionProvider(meal, profile, dailyTotals, apiKeys); }
        catch (e2) { throw e2; }
      }
      throw e;
    }
  }

  async function callDeepSeek(meal, profile, dailyTotals, apiKeys) {
    const proxy = apiKeys.deepseekProxy || 'http://localhost:8787/deepseek';
    if (!apiKeys.deepseek) throw new Error('缺少 DeepSeek API Key');

    const body = {
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: buildSystemRole() },
        { role: 'user',   content: buildPrompt(meal, profile, dailyTotals) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    };
    const resp = await fetch(proxy, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DeepSeek-Key': apiKeys.deepseek,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`DeepSeek 失败（${resp.status}）：${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return parseReview(text);
  }

  /** 走视觉接口同款 OpenAI 兼容通道（识别和评价共用一个 key/url） */
  async function callVisionProvider(meal, profile, dailyTotals, apiKeys) {
    if (!apiKeys.vision || !apiKeys.visionBaseUrl) {
      throw new Error('图像识别接口未配置，无法 fallback 到此处生成建议');
    }
    const text = await AIVision.chat([
      { role: 'system', content: buildSystemRole() },
      { role: 'user',   content: buildPrompt(meal, profile, dailyTotals) },
    ], apiKeys, { temperature: 0.4, json: true });
    return parseReview(text);
  }

  function parseReview(text) {
    let parsed = null;
    try { parsed = JSON.parse(text); }
    catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
    }
    if (!parsed) throw new Error('AI 营养师返回非 JSON');
    return {
      rating: Number(parsed.rating) || 0,
      summary: String(parsed.summary || ''),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
    };
  }

  return { reviewMeal };
})();
