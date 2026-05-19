/**
 * 本机默认配置 · 模板文件
 *
 * 用法：
 *   1. 复制本文件为同目录下的 config.local.js
 *   2. 填入你自己的 API Key（key 怎么获取见根目录 README）
 *   3. config.local.js 已在 .gitignore，不会被提交到仓库
 *
 * 也可以不创建本地文件，第一次打开应用走「引导」时手动填写，
 * key 会存到浏览器 localStorage。
 */
window.__DEFAULT_CONFIG__ = {
  // ===== 图像识别（OpenAI 兼容协议） =====
  // 任意支持 chat/completions + image_url 多模态的服务都可以
  // 比如 OpenAI 官方、Gemini 通过中转、各种国内代理
  vision: '',
  visionBaseUrl: 'https://xxx.com/v1/chat/completions',  // 完整接口 URL
  visionModel: 'gemini-2.5-flash',                       // 模型名（多模态）

  // ===== 评价生成（DeepSeek 走本地代理） =====
  deepseek: '',
  deepseekProxy: 'http://localhost:8787/deepseek',
  coachProvider: 'deepseek',   // 'deepseek' 或 'vision'（用视觉接口同款）
};
