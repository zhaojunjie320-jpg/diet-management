/**
 * 图像识别：调用 OpenAI 兼容的多模态接口（chat/completions + image_url）
 *
 * 兼容范围：
 *   - OpenAI 官方 GPT-4o
 *   - Google Gemini（通过 OpenAI 兼容代理，模型名如 gemini-2.5-flash）
 *   - 各类国内中转服务（AIHubMix / 老张 AI / chatfire 等，只要支持 chat/completions vision）
 *
 * 配置（apiKeys）：
 *   - vision        : Bearer Token（"sk-..."）
 *   - visionBaseUrl : 完整接口 URL，例如 "https://xxx.com/v1/chat/completions"
 *   - visionModel   : 模型名，例如 "gemini-2.5-flash"
 */
window.AIVision = (function () {

  const DEFAULT_MODEL = 'gemini-2.5-flash';

  /**
   * 把任意格式的 base URL 规范化成 chat/completions 完整地址
   * 接受：
   *   https://yinli.one
   *   https://yinli.one/v1
   *   https://yinli.one/v1/chat/completions
   */
  function normalizeEndpoint(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (/\/chat\/completions$/.test(u)) return u;
    if (/\/v\d+$/.test(u)) return u + '/chat/completions';
    return u + '/v1/chat/completions';
  }

  const PROMPT = `你是中文订餐账单识别助手。请仔细看这张支付宝订单截图，提取以下信息，严格输出 JSON。

要求：
1. 输出严格 JSON，不要任何额外解释、不要 markdown 包裹。
2. 字段：
{
  "restaurant": "餐厅名（截图顶部）",
  "items": [
    { "name": "菜名（清洗掉"特价菜""一份"等修饰词）", "grams": 100, "price": 5.96 }
  ],
  "paidTotal": 17.26,
  "orderTime": "2026-05-18T18:24:05"
}
3. grams 是数字（克），不要带单位；如果截图里没有克数，写 0。
4. price 单位元，数字。
5. orderTime 用 ISO 8601。如果截图里只有"取餐时间/结算时间"，挑一个最像下单时间的；都没有就用空字符串。
6. 菜名只保留核心，不要包含"（特价菜）"等括号修饰。

只输出 JSON。`;

  /**
   * 识别账单图
   * @param {Blob|File} imageBlob
   * @param {object} apiKeys - 来自 Storage.getApiKeys()
   * @returns {Promise<{restaurant, items, paidTotal, orderTime, _raw}>}
   */
  async function recognizeBill(imageBlob, apiKeys) {
    if (!apiKeys || !apiKeys.vision) {
      throw new Error('缺少图像识别 API Key，请到「设置」填写');
    }
    if (!apiKeys.visionBaseUrl) {
      throw new Error('缺少图像识别接口 URL，请到「设置」填写（形如 https://xxx.com/v1/chat/completions）');
    }
    const model = apiKeys.visionModel || DEFAULT_MODEL;

    const dataUrl = await blobToDataUrl(imageBlob);

    const body = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    };

    const resp = await fetch(normalizeEndpoint(apiKeys.visionBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKeys.vision,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`图像识别失败（${resp.status}）：${txt.slice(0, 300)}`);
    }
    const data = await resp.json();
    const text = extractText(data);
    if (!text) throw new Error('识别接口返回为空');

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('识别返回非 JSON：' + text.slice(0, 200));
    }

    return {
      restaurant: parsed.restaurant || '',
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [],
      paidTotal: Number(parsed.paidTotal) || 0,
      orderTime: parsed.orderTime || '',
      _raw: data,
    };
  }

  /** 兜底估算：本地营养表没匹配到时调用 */
  async function estimateNutrition(name, grams, apiKeys) {
    if (!apiKeys.vision || !apiKeys.visionBaseUrl) throw new Error('视觉接口未配置');
    const prompt = `估算这道中餐每 100g 可食部的营养成分。输出严格 JSON：
{ "calories": kcal, "protein": g, "fat": g, "carbs": g, "fiber": g, "sodium": mg, "isVeg": bool }
仅输出 JSON。菜名：${name}`;

    const body = {
      model: apiKeys.visionModel || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    };
    const resp = await fetch(normalizeEndpoint(apiKeys.visionBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKeys.vision,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error('AI 兜底估算失败');
    const data = await resp.json();
    const text = extractText(data);
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    const r = (grams || 0) / 100;
    return {
      calories: (Number(parsed.calories) || 0) * r,
      protein:  (Number(parsed.protein)  || 0) * r,
      fat:      (Number(parsed.fat)      || 0) * r,
      carbs:    (Number(parsed.carbs)    || 0) * r,
      fiber:    (Number(parsed.fiber)    || 0) * r,
      sodium:   (Number(parsed.sodium)   || 0) * r,
      calcium: 0, iron: 0, vitaminA: 0, vitaminC: 0,
      _aiEstimated: true,
      _isVeg: !!parsed.isVeg,
    };
  }

  /** 调 chat completions 给一段文本任务（评价时也能复用） */
  async function chat(messages, apiKeys, opts = {}) {
    if (!apiKeys.vision || !apiKeys.visionBaseUrl) throw new Error('视觉接口未配置');
    const body = {
      model: opts.model || apiKeys.visionModel || DEFAULT_MODEL,
      messages,
      temperature: opts.temperature ?? 0.4,
    };
    if (opts.json) body.response_format = { type: 'json_object' };
    const resp = await fetch(normalizeEndpoint(apiKeys.visionBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKeys.vision,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`接口失败（${resp.status}）：${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    return extractText(data);
  }

  function normalizeItem(it) {
    return {
      name: String(it.name || '').trim(),
      grams: Number(it.grams) || 0,
      price: Number(it.price) || 0,
    };
  }

  function extractText(resp) {
    try {
      // 标准 OpenAI 格式
      if (resp.choices && resp.choices[0]) {
        const msg = resp.choices[0].message || resp.choices[0].delta || {};
        if (typeof msg.content === 'string') return msg.content.trim();
        if (Array.isArray(msg.content)) {
          return msg.content.map(p => (typeof p === 'string' ? p : p.text || '')).join('').trim();
        }
      }
      // Gemini 原生格式（万一直连）
      if (resp.candidates && resp.candidates[0]) {
        const parts = resp.candidates[0].content.parts;
        return parts.map(p => p.text || '').join('').trim();
      }
    } catch (e) {}
    return '';
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  return { recognizeBill, estimateNutrition, chat, DEFAULT_MODEL };
})();
