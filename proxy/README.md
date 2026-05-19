# proxy/server.js

无依赖的本地服务器。同时干三件事：

| 路径 | 作用 |
|---|---|
| `GET /...` 任意文件 | 静态服务（应用入口、JS、CSS、图片） |
| `GET /api/screenshots` | 列出项目根目录下 `截图/` 里所有图片 |
| `POST /deepseek` | 转发到 https://api.deepseek.com（绕过浏览器跨域） |

## 启动

```bash
node proxy/server.js
```

默认监听 `http://localhost:8787`。换端口：

```bash
PORT=9000 node proxy/server.js              # macOS / Linux
$env:PORT=9000; node proxy/server.js        # PowerShell
```

启动后保持终端开着；关掉就停了。

## 用法

打开浏览器访问 **http://localhost:8787/** 加载应用。
不要再双击 `index.html`——`file://` 模式访问不了 `/api/screenshots`，批量导入面板出不来，DeepSeek 评价也调不通。

前端的「设置 → DeepSeek 代理地址」应该是 `http://localhost:8787/deepseek`，API Key 也填进设置里，代理只是中转。

## 安全

- 服务只监听 `127.0.0.1`（`localhost`），不会暴露到外网
- 防目录穿越：`/../etc/passwd` 这种请求会被拒
- DeepSeek 代理对 `X-DeepSeek-Key` 头透传到上游，不存任何日志
- 不下发任何浏览器 cookie/storage 访问权限给前端代码
