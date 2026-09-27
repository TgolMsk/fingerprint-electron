#!/usr/bin/env node
/*
 * 本地 HTTPS 静态服务（指纹一致性测试页用），仅依赖 Node 内置模块。
 * Service Worker 与跨站 iframe 场景要求安全上下文，故用 https 而非 http。
 *
 * 证书：默认读取同目录 cert.pem / key.pem，可用环境变量 CERT_FILE / KEY_FILE 覆盖。
 * 自签证书生成（在本目录执行）：
 *   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8443);
const ROOT = __dirname;
const CERT_FILE = process.env.CERT_FILE || path.join(ROOT, 'cert.pem');
const KEY_FILE = process.env.KEY_FILE || path.join(ROOT, 'key.pem');

if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
  console.error('[serve] 未找到 TLS 证书：');
  console.error('  cert: ' + CERT_FILE);
  console.error('  key : ' + KEY_FILE);
  console.error('请先生成自签证书（在本目录执行）：');
  console.error('  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"');
  console.error('或用环境变量指定已有证书路径：');
  console.error('  CERT_FILE=/path/cert.pem KEY_FILE=/path/key.pem node serve.js');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = https.createServer(
  { cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) },
  (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    const filePath = path.normalize(path.join(ROOT, pathname === '/' ? 'index.html' : pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  }
);

server.listen(PORT, () => {
  console.log(`[serve] https://localhost:${PORT}  (root: ${ROOT})`);
  console.log('[serve] 自签证书需在浏览器中手动信任（高级 → 继续前往）。');
});
