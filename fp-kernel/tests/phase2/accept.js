// 阶段 2 验收：两个账号（hardwareConcurrency 4 / 12）在主页面、跨站 iframe、
// Web Worker 三处读到各自的配置值；无配置页面返回宿主机真实值。
// 注意：Testing 构建下"窗口销毁后立刻新建"会触发网络栈竞态（ERR_FAILED），
// 因此三个窗口全部存活到最后统一销毁。
// 运行：D:\e\src\out\Testing\electron.exe accept.js
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const REAL_CORES = require('node:os').cpus().length;

// 主站 127.0.0.1 / iframe 站 localhost —— 不同 site，iframe 进独立渲染进程
const framePage = `<!doctype html><script>
  parent.postMessage({ from: 'iframe', hc: navigator.hardwareConcurrency }, '*');
<\/script>`;
const mainPage = (framePort) => `<!doctype html><body>
<iframe src="http://localhost:${framePort}/frame.html"></iframe>
<script>
  window.__results = { main: navigator.hardwareConcurrency };
  window.addEventListener('message', (e) => {
    if (e.data && e.data.from === 'iframe') window.__results.iframe = e.data.hc;
  });
  const w = new Worker('/worker.js');
  w.onmessage = (e) => { window.__results.worker = e.data.hc; };
<\/script></body>`;
const workerPage = `postMessage({ hc: navigator.hardwareConcurrency });`;

function startServers() {
  return new Promise((resolve) => {
    const main = http.createServer((req, res) => {
      const body = req.url === '/worker.js' ? workerPage : mainPage(servers.framePort);
      res.setHeader('content-type', req.url === '/worker.js' ? 'text/javascript' : 'text/html');
      res.end(body);
    });
    const frame = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(framePage);
    });
    main.on('error', (e) => console.log('[srv:main error]', e.message));
    frame.on('error', (e) => console.log('[srv:frame error]', e.message));
    global.__servers = { main, frame }; // 防 GC
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

function makeConfig(hc) {
  return JSON.stringify({
    schemaVersion: 1,
    seed: hc === 4 ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb',
    navigator: { platform: 'Win32', hardwareConcurrency: hc, deviceMemory: 8, languages: ['en-US', 'en'] },
  });
}

const windows = []; // 统一销毁

function makeWindow(ses) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  windows.push(win);
  return win;
}

async function testAccount(id, hc, servers) {
  const ses = session.fromPartition(`persist:acc-${id}`);
  await ses.setProxy({ mode: 'direct' }); // 验收与代理无关，直连本地服务
  ses.setFingerprintConfig(makeConfig(hc));
  const win = makeWindow(ses);
  await win.loadURL(`http://127.0.0.1:${servers.mainPort}/main.html`);
  // 轮询三处结果齐备
  for (let i = 0; i < 40; i++) {
    const r = await win.webContents.executeJavaScript('JSON.stringify(window.__results || {})');
    const parsed = JSON.parse(r);
    if (parsed.main !== undefined && parsed.iframe !== undefined && parsed.worker !== undefined) {
      return parsed;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('timeout waiting results');
}

async function testNoConfig(servers) {
  const ses = session.fromPartition('persist:plain');
  await ses.setProxy({ mode: 'direct' });
  const win = makeWindow(ses);
  await win.loadURL(`http://127.0.0.1:${servers.mainPort}/main.html`);
  await new Promise((res) => setTimeout(res, 1500));
  return win.webContents.executeJavaScript('navigator.hardwareConcurrency');
}

app.whenReady().then(async () => {
  await session.defaultSession.setProxy({ mode: 'direct' });
  let failed = false;
  const check = (name, got, want) => {
    const ok = got === want;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got=${got} want=${want}`);
  };

  try {
    check('kernel api exists', typeof session.defaultSession.setFingerprintConfig, 'function');
    check('fpkernel version', process.versions.fpkernel, '0.1.0');

    const servers = await startServers();
    const a = await testAccount('a4', 4, servers);
    check('acc A main', a.main, 4);
    check('acc A iframe(cross-site)', a.iframe, 4);
    check('acc A worker', a.worker, 4);
    const b = await testAccount('b12', 12, servers);
    check('acc B main', b.main, 12);
    check('acc B iframe(cross-site)', b.iframe, 12);
    check('acc B worker', b.worker, 12);
    const plain = await testNoConfig(servers);
    check('no-config = host real cores', plain, REAL_CORES);
  } catch (err) {
    failed = true;
    console.log('FAIL exception:', err.message);
  }

  for (const w of windows) w.destroy();
  console.log(failed ? '=== PHASE2 ACCEPT: FAIL ===' : '=== PHASE2 ACCEPT: ALL PASS ===');
  app.exit(failed ? 1 : 0);
});
