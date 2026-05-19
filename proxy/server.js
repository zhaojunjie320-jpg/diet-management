/**
 * 饮食管理本地服务器
 * --------------------
 * 单文件、无依赖。一个进程同时干三件事：
 *   1) 静态服务：访问 http://localhost:8787/ 加载整个 SPA
 *   2) /api/screenshots：列出 截图/ 目录下所有图片
 *   3) /deepseek：转发到 DeepSeek 官方 API（绕过浏览器跨域）
 *
 * 启动：
 *   node proxy/server.js          # 默认 8787
 *   PORT=9000 node proxy/server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;
const ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = '截图';
const DEEPSEEK_UPSTREAM = 'https://api.deepseek.com/chat/completions';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif', '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    // DeepSeek 代理
    if (req.method === 'POST' && pathname.startsWith('/deepseek')) {
      return handleDeepSeek(req, res);
    }
    // 截图列表 API
    if (req.method === 'GET' && pathname === '/api/screenshots') {
      return handleScreenshotsList(res);
    }
    // 静态文件
    if (req.method === 'GET') {
      return handleStatic(res, pathname);
    }
    res.writeHead(404, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Not Found');
  } catch (e) {
    console.error(e);
    res.writeHead(500, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Server error: ' + e.message);
  }
});

// ---- 1. DeepSeek 代理 ----
function handleDeepSeek(req, res) {
  const apiKey = req.headers['x-deepseek-key'];
  if (!apiKey) {
    res.writeHead(401, corsHeaders({ 'Content-Type': 'application/json' }));
    return res.end(JSON.stringify({ error: 'missing X-DeepSeek-Key header' }));
  }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const upUrl = new URL(DEEPSEEK_UPSTREAM);
    const opts = {
      method: 'POST',
      hostname: upUrl.hostname,
      path: upUrl.pathname + upUrl.search,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const upReq = https.request(opts, upRes => {
      const headers = corsHeaders({
        'Content-Type': upRes.headers['content-type'] || 'application/json',
      });
      res.writeHead(upRes.statusCode || 502, headers);
      upRes.pipe(res);
    });
    upReq.on('error', err => {
      res.writeHead(502, corsHeaders({ 'Content-Type': 'application/json' }));
      res.end(JSON.stringify({ error: 'upstream error', detail: String(err) }));
    });
    upReq.write(body); upReq.end();
  });
}

// ---- 2. 截图列表 API ----
function handleScreenshotsList(res) {
  const dir = path.join(ROOT, SCREENSHOTS_DIR);
  fs.readdir(dir, (err, files) => {
    const headers = corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' });
    if (err) {
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ files: [], error: err.code || String(err) }));
    }
    const imgs = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    const items = imgs.map(name => {
      let stat = null;
      try { stat = fs.statSync(path.join(dir, name)); } catch (e) {}
      return {
        name,
        size: stat ? stat.size : 0,
        mtime: stat ? stat.mtime.toISOString() : null,
        url: '/' + SCREENSHOTS_DIR + '/' + encodeURIComponent(name),
        dateFromName: extractDateFromName(name),
      };
    }).sort((a, b) =>
      (a.dateFromName || '').localeCompare(b.dateFromName || '') ||
      a.name.localeCompare(b.name)
    );
    res.writeHead(200, headers);
    res.end(JSON.stringify({ files: items }));
  });
}

// "Screenshot_2026-05-18-18-26-16-817_..." → "2026-05-18"
function extractDateFromName(name) {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ---- 3. 静态服务 ----
function handleStatic(res, pathname) {
  let target = pathname === '/' ? '/index.html' : pathname;
  let filepath = path.normalize(path.join(ROOT, target));
  // 防穿越
  if (!filepath.startsWith(ROOT)) {
    res.writeHead(403, corsHeaders({ 'Content-Type': 'text/plain' }));
    return res.end('Forbidden');
  }
  fs.stat(filepath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('Not Found: ' + target);
    }
    const ext = path.extname(filepath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, corsHeaders({
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    }));
    fs.createReadStream(filepath).pipe(res);
  });
}

function corsHeaders(extra = {}) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-DeepSeek-Key',
    'Access-Control-Max-Age': '86400',
  }, extra);
}

// 只监听 127.0.0.1，避免被同局域网其他人访问
server.listen(PORT, '127.0.0.1', () => {
  console.log('饮食管理本地服务已启动');
  console.log(`  · 应用入口     http://localhost:${PORT}/`);
  console.log(`  · 截图列表     http://localhost:${PORT}/api/screenshots`);
  console.log(`  · DeepSeek代理 http://localhost:${PORT}/deepseek`);
  console.log('');
  console.log('浏览器打开应用入口即可（不要再双击 index.html）');
});
