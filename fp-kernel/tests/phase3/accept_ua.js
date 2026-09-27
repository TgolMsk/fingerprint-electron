// fp_10 验收：UA 与 Client Hints
// 1) UA 无 Electron 痕迹（默认与账号配置两种）
// 2) userAgentData.brands = 真 Chrome 三品牌（含 "Google Chrome"）
// 3) 导航请求带 Sec-CH-UA / Sec-CH-UA-Mobile / Sec-CH-UA-Platform 头
// 4) 账号 ua.string 在 主页面/跨站iframe/Worker/ServiceWorker 四处一致
// 5) 高熵值（platform/platformVersion/arch/bitness）按配置下发
// 运行：D:\e\src\out\Testing\electron.exe accept_ua.js
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const REAL_CHROME_MAJOR = process.versions.chrome.split('.')[0];
const navHeaders = []; // 记录导航请求头
const subHeaders = []; // 记录子资源请求头

const swScript = `
  self.addEventListener('install', (e) => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
  self.addEventListener('message', (e) => {
    e.ports[0].postMessage({ ua: navigator.userAgent });
  });
`;
const framePage = `<!doctype html><script>
  parent.postMessage({ from: 'iframe', ua: navigator.userAgent }, '*');
<\/script>`;
const workerScript = `postMessage({ ua: navigator.userAgent });`;
const mainPage = (framePort) => `<!doctype html><body>
<img src="/subresource.png" width="1" height="1"/>
<iframe src="http://localhost:${framePort}/frame.html"></iframe>
<script>
  window.__results = { main: navigator.userAgent };
  (async () => {
    window.__results.uaData = await navigator.userAgentData.getHighEntropyValues(
      ['architecture', 'bitness', 'fullVersionList', 'platform', 'platformVersion']);
    window.__results.brands = navigator.userAgentData.brands;
  })();
  window.addEventListener('message', (e) => {
    if (e.data && e.data.from === 'iframe') window.__results.iframe = e.data.ua;
  });
  const w = new Worker('/worker.js');
  w.onmessage = (e) => { window.__results.worker = e.data.ua; };
  navigator.serviceWorker.register('/sw.js').then(async () => {
    const reg = await navigator.serviceWorker.ready;
    const ask = () => {
      const sw = navigator.serviceWorker.controller || reg.active;
      if (!sw) return;
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => { window.__results.sw = e.data.ua; };
      sw.postMessage({}, [ch.port2]);
    };
    ask(); setTimeout(ask, 500); setTimeout(ask, 1500);
  });
<\/script></body>`;

function startServers() {
  return new Promise((resolve) => {
    const main = http.createServer((req, res) => {
      if (req.url === '/main.html') navHeaders.push(req.headers);
      else if (req.url === '/subresource.png') subHeaders.push(req.headers);
      const type = { '/worker.js': 'text/javascript', '/sw.js': 'text/javascript', '/subresource.png': 'image/png' }[req.url] || 'text/html';
      res.setHeader('content-type', type);
      res.end({ '/worker.js': workerScript, '/sw.js': swScript, '/subresource.png': Buffer.alloc(8) }[req.url] || mainPage(servers.framePort));
    });
    const frame = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(framePage);
    });
    global.__servers = { main, frame };
    const servers = {};
    main.listen(0, '127.0.0.1', () => {
      servers.mainPort = main.address().port;
      frame.listen(0, 'localhost', () => {
        servers.framePort = frame.address().port;
        resolve(servers);
      });
    });
  });
}

const CUSTOM_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

function makeConfig() {
  return JSON.stringify({
    schemaVersion: 1,
    seed: 'cccccccccccccccc',
    ua: { brand: 'Google Chrome', fullVersion: process.versions.chrome, platform: 'Windows', platformVersion: '15.0.0', arch: 'x86', bitness: '64', string: CUSTOM_UA },
    navigator: { platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8, languages: ['en-US', 'en'] },
  });
}

const windows = [];

async function collect(id, servers, withConfig) {
  const ses = session.fromPartition(`persist:ua-${id}`);
  await ses.setProxy({ mode: 'direct' });
  if (withConfig) {
    ses.setFingerprintConfig(makeConfig());
    ses.setUserAgent(CUSTOM_UA, 'en-US,en');
  }
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  windows.push(win);
  await win.loadURL(`http://127.0.0.1:${servers.mainPort}/main.html`);
  for (let i = 0; i < 60; i++) {
    const r = JSON.parse(await win.webContents.executeJavaScript(
      'JSON.stringify({r: window.__results || {}, swc: !!navigator.serviceWorker.controller})'));
    if (r.r.main && r.r.iframe && r.r.worker && r.r.sw && r.r.uaData) return r.r;
    if (i % 8 === 7) console.log('[collect]', id, JSON.stringify(Object.keys(r.r)), 'swc=', r.swc);
    await new Promise((res) => setTimeout(res, 250));
  }
  const dump = await win.webContents.executeJavaScript('JSON.stringify(window.__results || {})').catch(() => 'n/a');
  console.log('[collect dump]', id, dump);
  throw new Error('timeout collecting ' + id);
}

app.whenReady().then(async () => {
  await session.defaultSession.setProxy({ mode: 'direct' });
  let failed = false;
  const check = (name, cond, detail = '') => {
    if (!cond) failed = true;
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  };

  try {
    const servers = await startServers();

    // ---- 账号配置 ----
    const acc = await collect('acc', servers, true);
    check('acc main UA = config ua.string', acc.main === CUSTOM_UA, acc.main);
    check('acc iframe UA 一致', acc.iframe === CUSTOM_UA, acc.iframe);
    check('acc worker UA 一致', acc.worker === CUSTOM_UA, acc.worker);
    check('acc service worker UA 一致', acc.sw === CUSTOM_UA, acc.sw);
    const brands = (acc.brands || []).map((b) => b.brand);
    check('brands 含 Google Chrome', brands.includes('Google Chrome'), brands.join(','));
    check('brands 含 Chromium', brands.includes('Chromium'), brands.join(','));
    check('brands 含 GREASE(Not.A.Brand)', brands.some((b) => b.includes('Not') && b.includes('Brand')), brands.join(','));
    check('brand major = 内核版本', (acc.brands || []).find((b) => b.brand === 'Google Chrome')?.version === REAL_CHROME_MAJOR);
    check('uaData.platform = Windows', acc.uaData.platform === 'Windows', acc.uaData.platform);
    check('uaData.platformVersion = 15.0.0', acc.uaData.platformVersion === '15.0.0', acc.uaData.platformVersion);
    check('uaData.arch = x86', acc.uaData.architecture === 'x86', acc.uaData.architecture);
    check('uaData.bitness = 64', acc.uaData.bitness === '64', acc.uaData.bitness);
    const fvl = (acc.uaData.fullVersionList || []).find((b) => b.brand === 'Google Chrome');
    check('fullVersionList Google Chrome 版本 = 内核真实版本', fvl?.version === process.versions.chrome, fvl?.version);

    // ---- 导航请求头（账号会话）----
    const nav = navHeaders[navHeaders.length - 1] || {};
    check('导航 Sec-CH-UA 含 Google Chrome', /Google Chrome/.test(nav['sec-ch-ua'] || ''), nav['sec-ch-ua']);
    check('导航 Sec-CH-UA-Mobile = ?0', nav['sec-ch-ua-mobile'] === '?0', nav['sec-ch-ua-mobile']);
    check('导航 Sec-CH-UA-Platform = "Windows"', nav['sec-ch-ua-platform'] === '"Windows"', nav['sec-ch-ua-platform']);
    check('导航 UA 头 = 账号 UA', nav['user-agent'] === CUSTOM_UA, nav['user-agent']);
    const sub = subHeaders[subHeaders.length - 1] || {};
    check('子资源 Sec-CH-UA 含 Google Chrome', /Google Chrome/.test(sub['sec-ch-ua'] || ''), sub['sec-ch-ua']);

    // ---- 默认会话（无配置）：UA 无 Electron，brands 仍有 Google Chrome ----
    const plain = await collect('plain', servers, false);
    check('默认 UA 无 Electron', !/Electron/.test(plain.main), plain.main);
    check('默认 UA 为 Chrome 形态', plain.main.includes(`Chrome/${process.versions.chrome}`), plain.main);
    const plainBrands = (plain.brands || []).map((b) => b.brand);
    check('默认 brands 含 Google Chrome', plainBrands.includes('Google Chrome'), plainBrands.join(','));
  } catch (err) {
    failed = true;
    console.log('FAIL exception:', err.message);
  }

  for (const w of windows) w.destroy();
  console.log(failed ? '=== FP_10 ACCEPT: FAIL ===' : '=== FP_10 ACCEPT: ALL PASS ===');
  app.exit(failed ? 1 : 0);
});
