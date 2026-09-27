// fp_13 + fp_14 验收：webdriver / 时区 / 语言
// 运行：D:\e\src\out\Testing\electron.exe accept_tz.js
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const workerScript = `postMessage({
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  lang: navigator.language,
  webdriver: navigator.webdriver === undefined ? 'undefined' : navigator.webdriver,
});`;
const mainPage = `<!doctype html><script>
  window.__results = {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    langs: navigator.languages,
    webdriver: navigator.webdriver,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    offset: new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),
  };
  const w = new Worker('/worker.js');
  w.onmessage = (e) => { window.__results.worker = e.data; };
<\/script>`;

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('content-type', req.url === '/worker.js' ? 'text/javascript' : 'text/html');
      res.end(req.url === '/worker.js' ? workerScript : mainPage);
    });
    global.__srv = srv;
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

function makeConfig(tz, lang) {
  return JSON.stringify({
    schemaVersion: 1,
    seed: 'dddddddddddddddd',
    timezone: tz,
    navigator: { platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8, languages: [lang] },
  });
}

const windows = [];

async function collect(id, port, cfg) {
  const ses = session.fromPartition(`persist:tz-${id}`);
  await ses.setProxy({ mode: 'direct' });
  if (cfg) {
    ses.setFingerprintConfig(makeConfig(cfg.tz, cfg.lang));
    ses.setUserAgent('test', cfg.lang);
  }
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  windows.push(win);
  await win.loadURL(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 40; i++) {
    const r = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__results || {})'));
    if (r.tz && r.worker) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('timeout ' + id);
}

app.whenReady().then(async () => {
  await session.defaultSession.setProxy({ mode: 'direct' });
  let failed = false;
  const check = (name, cond, detail = '') => {
    if (!cond) failed = true;
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  };

  try {
    const port = await startServer();

    const a = await collect('ny', port, { tz: 'America/New_York', lang: 'en-US' });
    check('A webdriver === false', a.webdriver === false, String(a.webdriver));
    check('A worker webdriver undefined 或 false', a.worker.webdriver === 'undefined' || a.worker.webdriver === false, String(a.worker.webdriver));
    check('A 时区 = America/New_York', a.tz === 'America/New_York', a.tz);
    check('A Worker 时区一致', a.worker.tz === 'America/New_York', a.worker.tz);
    check('A 语言 = en-US', a.lang === 'en-US', a.lang);
    check('A Worker 语言一致', a.worker.lang === 'en-US', a.worker.lang);
    check('A Intl locale = en-US', a.locale === 'en-US', a.locale);
    check('A 时区偏移 = 300 (EST)', a.offset === 300, String(a.offset));

    const b = await collect('jp', port, { tz: 'Asia/Tokyo', lang: 'ja-JP' });
    check('B 时区 = Asia/Tokyo', b.tz === 'Asia/Tokyo', b.tz);
    check('B 语言 = ja-JP', b.lang === 'ja-JP', b.lang);
    check('B Intl locale = ja-JP', b.locale === 'ja-JP', b.locale);
    check('B 时区偏移 = -540 (JST)', b.offset === -540, String(b.offset));

    const plain = await collect('plain', port, null);
    check('默认 webdriver === false', plain.webdriver === false, String(plain.webdriver));
    // 宿主机时区即 America/New_York：无配置时必须显示宿主机真实时区（未被 A/B 污染）
    check('默认时区 = 宿主机真实时区', plain.tz === 'America/New_York', plain.tz);
    check('默认语言 = 宿主机语言（非 en-US/ja-JP）', plain.lang !== 'en-US' && plain.lang !== 'ja-JP', plain.lang);
  } catch (err) {
    failed = true;
    console.log('FAIL exception:', err.message);
  }

  for (const w of windows) w.destroy();
  console.log(failed ? '=== FP_13/14 ACCEPT: FAIL ===' : '=== FP_13/14 ACCEPT: ALL PASS ===');
  app.exit(failed ? 1 : 0);
});
