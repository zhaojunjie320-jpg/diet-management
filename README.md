# 饮食管理 · 个人营养助手

> 拖一张支付宝订单截图进来 → AI 识别菜名/克重/价格 → 查营养表 → 给评分和建议 → 一键导出抖音分享卡

![tech](https://img.shields.io/badge/stack-Vue%203%20CDN%20%2B%20vanilla%20JS-blue)
![storage](https://img.shields.io/badge/storage-IndexedDB%20%2F%20localStorage-orange)
![license](https://img.shields.io/badge/license-MIT-green)
![no--build](https://img.shields.io/badge/build-none-lightgrey)

一个纯前端 SPA + 一个零依赖的 Node 本地服务器（静态托管 + 截图目录列表 + DeepSeek 跨域代理）。

数据完全保存在浏览器本地（IndexedDB + localStorage），不上传到任何服务器；API Key 走前端直连模型供应商，所有原料、营养、AI 点评都在你这台机器内部流转。

## 主要功能

- 📷 **账单识别**：拖一张支付宝订单截图进来，AI 自动识别菜名、克重、价格
- 📂 **批量导入**：扫描 `截图/` 目录里所有图片，按日期分组、SHA-256 去重，一键全量导入
- 🍳 **默认早餐**：可配置模板（默认 400g 牛奶 + 100g 鸡蛋 + 50g 燕麦），一键补今天
- 🥗 **营养计算**：内置《中国食物成分表》核心数据（70+ 条），未匹配项调 AI 估算
- 📊 **单餐报告**：三大供能比环形图、营养总览、异常提醒（钠超标 / 蔬菜不足 / 脂肪占比偏高等）
- 🤖 **AI 营养师**：DeepSeek 基于个人目标 + 当日累计数据给出 1-10 评分 + 总结 + 3 条具体建议
- 💥 **拆弹/被炸主题**：今日页根据热量和宏量给出 5 种状态（拆弹专家 / 临界 / 导火索 / 被炸了 / 没记账），带 emoji 动画
- 📱 **抖音分享卡**：一键导出 1080×1920 PNG 海报，今日总览 + 单餐详情两种模板可切换
- 📅 **今日 / 历史 / 趋势**：今日累计 vs 目标、按天回看、近 7/30 天热量与宏量趋势图
- 🎯 **个人目标**：Mifflin-St Jeor 公式算 BMR/TDEE，按减脂/维持/增肌自动推荐宏量分配

## 截图

> TODO: 把导出的 1080×1920 分享卡 / 主界面截图放到 `docs/screenshots/` 然后在这里嵌入。

## 文件结构

```
饮食管理/
├── index.html              # 入口，双击打开
├── css/style.css           # 样式
├── js/
│   ├── app.js              # Vue 主应用
│   ├── ai-vision.js        # 图像识别（OpenAI 兼容协议）
│   ├── ai-coach.js         # DeepSeek 评价（视觉接口可 fallback）
│   ├── nutrition-db.js     # 食物匹配
│   ├── storage.js          # IndexedDB 封装
│   ├── targets.js          # TDEE / 宏量计算
│   ├── charts.js           # ECharts 图表
│   └── alerts.js           # 异常规则
├── data/
│   ├── food-db.js                # 食物营养库
│   └── config.local.example.js   # 配置模板（复制为 config.local.js 后填 key）
├── js/batch-import.js            # 扫描 截图/ 目录、批量识别、SHA-256 去重
├── proxy/server.js               # 本地服务器：静态 + 截图列表 API + DeepSeek 代理
└── 截图/                          # 把你的支付宝订单截图放这里（已 gitignore）
```

## 使用步骤

### 1. 准备 API Key

需要两个 OpenAI 兼容的 API：

| 用途 | 推荐 | 说明 |
|---|---|---|
| 图像识别 | 任意支持 chat/completions 多模态的中转服务（GPT-4o / Gemini-2.5-Flash / 等） | 接口要走 `POST /v1/chat/completions` 协议、支持 `image_url` |
| 文字评价 | [DeepSeek](https://platform.deepseek.com/api_keys) | 中文质量好、便宜 |

可以**只配图像识别那一个**（识图 + 评价都让它做），那就不需要 DeepSeek 也不需要代理——在「设置 → 建议生成模型」选「视觉接口同款」即可。

### 2. 预填 API Key（可选）

复制配置模板：

```bash
cp data/config.local.example.js data/config.local.js
```

打开 `data/config.local.js`，把 key 和接口 URL 填进去：

```js
window.__DEFAULT_CONFIG__ = {
  vision: 'sk-...',                                              // 图像识别 key
  visionBaseUrl: 'https://yinli.one/v1/chat/completions',        // 完整接口 URL（yinli.one 已预填）
  visionModel: 'gemini-2.5-flash',
  deepseek: 'sk-...',                                            // DeepSeek key
  deepseekProxy: 'http://localhost:8787/deepseek',
  coachProvider: 'deepseek',
};
```

也可以不填这个文件，等到第一次打开应用时在「引导」里手动填，效果一样。

### 3. 启动本地服务

```bash
node proxy/server.js
```

成功后终端会显示：

```
饮食管理本地服务已启动
  · 应用入口     http://localhost:8787/
  · 截图列表     http://localhost:8787/api/screenshots
  · DeepSeek代理 http://localhost:8787/deepseek
```

### 4. 在浏览器打开 http://localhost:8787/

不要再双击 `index.html`。通过 `http://localhost:8787/` 打开是**自动扫描截图**、**DeepSeek 评价**、**避免 CORS** 三件事一起搞定的前提。

第一次会弹出引导：填性别/年龄/身高/体重 → 选活动等级 → 选目标 → 看推荐能量预算 → 确认 / 填 API Key。

### 5. 把所有订单截图扔进 截图/ 目录

往项目目录的 `截图/` 文件夹拖入任意多张支付宝订单截图，浏览器打开应用后，**今日页顶部**会显示「批量导入」面板：

```
共 N 张        已导入 X        待导入 Y
[ ] 导入完成后为每天自动补默认早餐（400g 牛奶、100g 鸡蛋、50g 燕麦）
[ 导入 Y 张 ]
```

点击「导入 Y 张」即可：
1. 逐张调图像识别接口 → 解析菜名/克重/价格
2. 逐项匹配本地营养表，找不到的让 AI 估算
3. 按下单时间归到对应日期
4. 自动按勾选项给每天补一份默认早餐（如果当天还没有早餐）
5. 全部保存到 IndexedDB

如果只想录一餐，也可以拖到下方的「新增账单」上传区。

### 6. 默认早餐

「为今天补默认早餐」按钮在新增账单卡片下方，一键加入：400g 牛奶 + 100g 鸡蛋（约 2 个）+ 50g 燕麦，营养约 544 kcal / 33g 蛋白 / 25g 脂肪 / 47g 碳水。批量导入时也可以勾选自动为每个有订单的日期补一份。

## 验证

把任意支付宝订单截图（带菜名 + 克重）放进 `截图/` 目录，然后刷新应用、点「导入待导入的 X 张」。

通过标准：识别 100% 拿到所有菜、营养匹配命中率 ≥80%（剩余项由 AI 兜底，不会报错）。

## 数据存哪里

| 数据 | 位置 | 说明 |
|---|---|---|
| 个人信息 / 目标 / 阈值 | localStorage `diet:profile` | 浏览器本地 |
| API Key | localStorage `diet:apikeys` | 不会被导出 |
| 用餐记录 | IndexedDB `diet-mgmt.meals` | |
| 原图 | IndexedDB `diet-mgmt.images` | 留底备查 |

「设置 → 数据 → 导出全部数据」可以下载 JSON 备份（不含 API Key）。

## 注意事项

- **API Key 安全**：Key 在浏览器和 `data/config.local.js` 里。这是单用户本地工具，不要把项目目录原样分享给别人。
- **必须走 http://localhost:8787**：如果还是双击 index.html（file://）打开，浏览器无法扫描本地目录，批量导入面板就不会出现；DeepSeek 评价也调不通。
- **localStorage 与 file:// 不互通**：如果以前用 file:// 存过设置，第一次切到 http://localhost 会是空白状态，重新走一遍引导即可。
- **识别准确度**：多模态模型对支付宝订单格式识别很稳定，但偶尔会把"克重"漏掉。识别后可以在前端手动改（后续可扩展编辑功能）。
- **营养数据库**：当前 ~75 条核心条目，覆盖了食堂最常见的菜 + 早餐常用的牛奶/鸡蛋/燕麦。遇到不认识的会让 AI 估算并打 `AI` 标签——精确度会差一些。

## 开发笔记

- 不需要 build。直接编辑 JS / CSS / HTML 文件，刷新浏览器即可。
- 各模块通过 `window.XXX` 暴露，不用模块系统（避免 file:// 的 CORS 限制）。
- 修改 `data/food-db.js` 可以增删营养数据；改字段后整个项目会自动用新数据。
