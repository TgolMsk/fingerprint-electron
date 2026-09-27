const { app, BaseWindow, WebContentsView, session, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadAccounts, saveAccounts, addAccount } = require('./accounts');
const { generateFingerprint } = require('./fp-generator');
const { createFingerprintView, AutomationManager } = require('../../fp-sdk');
const { createManagementWindow } = require('./management');

const SIDEBAR = 260, TOPBAR = 88, GAP = 12, HEADER = 32;
const DEFAULT_URL = 'fp-test://local/';
const MAX_INSTANCES = 6;
const views = new Map(), runtime = new Map();
let win = null, sidebarView = null, currentId = null, localServer = null, localUrl = null;
let layout = 'single', inspection = null, closing = false, exportDirectory = null, latestExport = null;
let automation = null, management = null;
const shellPath = path.join(__dirname, 'sidebar', 'index.html');

function safeAccounts() { return loadAccounts().map(({ proxyAuth, ...account }) => account); }

async function startLocalServer() {
  const root = path.join(__dirname, 'testing');
  localServer = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end('Invalid path'); return; }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(file)];
    if (!mime) { response.writeHead(404); response.end(); return; }
    fs.readFile(file, (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data:; object-src 'none'" });
      response.end(content);
    });
  });
  await new Promise((resolve, reject) => { localServer.once('error', reject); localServer.listen(0, '127.0.0.1', resolve); });
  localUrl = `http://127.0.0.1:${localServer.address().port}/`;
}

function navigationURL(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请输入网址。');
  let value = input.trim();
  if (value === DEFAULT_URL) return localUrl;
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = 'https://' + value;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP、HTTPS 和本地检测页。');
  if (url.username || url.password) throw new Error('网址中不能包含用户名或密码。');
  return url.href;
}
function displayURL(url) { return url === localUrl ? DEFAULT_URL : url; }

function getState() {
  return { accounts: safeAccounts(), currentId, layout,
    instances: [...views].map(([id, view]) => {
      const wc = view.webContents, state = runtime.get(id) || {};
      return { id, ...state, url: displayURL(wc.getURL() || state.url || ''), title: wc.getTitle(),
        loading: wc.isLoading(), visible: view.getVisible(), canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(), bounds: view.getBounds(), headerBounds: state.headerBounds || null };
    }),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, fpkernel: process.versions.fpkernel },
    inspection, latestExport, maxInstances: MAX_INSTANCES };
}
function pushState(accountsChanged = false) {
  if (closing || !sidebarView || sidebarView.webContents.isDestroyed()) return;
  if (accountsChanged) sidebarView.webContents.send('accounts-changed', safeAccounts());
  sidebarView.webContents.send('state-changed', getState());
}

function layoutViews() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  sidebarView.setBounds({ x: 0, y: 0, width, height });
  const visible = layout === 'compare' ? [...views.keys()] : [currentId].filter(Boolean);
  const columns = Math.min(3, Math.max(1, visible.length)), rows = Math.ceil(visible.length / columns) || 1;
  const areaWidth = Math.max(1, width - SIDEBAR - GAP * 2), areaHeight = Math.max(HEADER + 1, height - TOPBAR - GAP * 2);
  const cellWidth = Math.floor((areaWidth - GAP * (columns - 1)) / columns), cellHeight = Math.floor((areaHeight - GAP * (rows - 1)) / rows);
  for (const [id, view] of views) {
    const index = visible.indexOf(id); view.setVisible(index !== -1);
    if (index === -1) continue;
    const col = index % columns, row = Math.floor(index / columns);
    const x = SIDEBAR + GAP + col * (cellWidth + GAP), y = TOPBAR + GAP + row * (cellHeight + GAP);
    const w = col === columns - 1 ? width - GAP - x : cellWidth, h = row === rows - 1 ? height - GAP - y : cellHeight;
    runtime.get(id).headerBounds = { x, y, width: w, height: HEADER };
    view.setBounds({ x, y: y + HEADER, width: Math.max(1, w), height: Math.max(1, h - HEADER) });
  }
  pushState();
}
function showAccount(_targetWin, id) {
  if (!views.has(id)) return false;
  currentId = id; layoutViews(); return true;
}
function rememberURL(id, url) {
  if (!url || url === 'about:blank') return;
  const list = loadAccounts(), account = list.find(item => item.id === id), value = displayURL(url);
  if (account && account.url !== value) { account.url = value; saveAccounts(list); }
}
async function loadURL(id, url) {
  const view = views.get(id);
  if (!view || view.webContents.isDestroyed()) throw new Error('实例不存在。');
  const resolved = navigationURL(url), state = runtime.get(id);
  state.error = null; state.url = resolved; rememberURL(id, resolved); pushState();
  try { await view.webContents.loadURL(resolved); return { id, ok: true }; }
  catch (error) {
    if (error.code !== 'ERR_ABORTED' && error.errno !== -3) state.error = error.message;
    pushState(); return { id, ok: false, error: error.message };
  }
}

async function createAccountView(account) {
  // The bundled page may copy its report; enumeration requires no hardware grant.
  const allowLocalCopy = (permission, url) => {
    try { return permission === 'clipboard-sanitized-write' && new URL(url).origin === new URL(localUrl).origin; }
    catch { return false; }
  };
  const view = await createFingerprintView({ profile:account, configureSession(ses) {
    ses.setPermissionCheckHandler((_contents, permission, origin) => allowLocalCopy(permission, origin));
    ses.setPermissionRequestHandler((_contents, permission, callback, details) => callback(allowLocalCopy(permission, details.requestingUrl)));
  } });
  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  runtime.set(account.id, { url: account.url, error: null });
  for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated']) wc.on(event, () => pushState());
  const navigated = (_event, url) => { if (!closing) { rememberURL(account.id, url); pushState(); } };
  wc.on('did-navigate', navigated);
  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame) navigated(_event, url); });
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    const state = runtime.get(account.id);
    if (!closing && state && isMainFrame && code !== -3) { state.error = `${description} (${code})`; pushState(); }
  });
  wc.on('render-process-gone', (_event, details) => {
    const state = runtime.get(account.id);
    if (!closing && state) { state.error = `页面进程已退出：${details.reason}；可点击刷新重试。`; pushState(); }
  });
  wc.on('focus', () => { if (!closing && currentId !== account.id) { currentId = account.id; pushState(); } });
  wc.setWindowOpenHandler(({ url }) => {
    try { navigationURL(url); void loadURL(account.id, url); } catch {}
    return { action: 'deny' };
  });
  return view;
}
async function ensureAccountView(account) {
  if (!views.has(account.id)) {
    const view = await createAccountView(account);
    win.contentView.addChildView(view); view.setVisible(false); views.set(account.id, view);
    await automation.attach(account.id, view);
    view.ready = loadURL(account.id, account.url);
  }
  return views.get(account.id);
}
function seedDemoAccounts(defaultUrl) {
  const list = loadAccounts(); if (list.length) return list;
  for (let i = 1; i <= 3; i++) addAccount({ name: `实例 ${String(i).padStart(2, '0')}`, url: defaultUrl, proxy: '' });
  return loadAccounts();
}
function requireTrusted(event) {
  if (closing || !sidebarView || event.sender !== sidebarView.webContents ||
      event.senderFrame !== sidebarView.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(shellPath).href) {
    throw new Error('此操作仅允许测试工作台界面调用。');
  }
}
function handle(channel, callback) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event, ...args) => { requireTrusted(event); return callback(...args); });
}

async function inspectInstance(id = currentId) {
  const view = views.get(id), account = loadAccounts().find(item => item.id === id);
  if (!view || !account) throw new Error('请选择一个实例。');
  const collectFingerprint = require('./testing/fingerprint-probe');
  const wc = view.webContents, inspectedURL = wc.getURL();
  let timer;
  try {
    const values = await Promise.race([wc.executeJavaScript(`(${collectFingerprint.toString()})()`),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('采集超时，请等待页面加载完成后重试。')), 10000); })]);
    if (wc.isDestroyed() || wc.getURL() !== inspectedURL) throw new Error('采集期间页面发生跳转，请重试。');
    inspection = { id, values, config: account.fp, at: new Date().toISOString(), url: inspectedURL };
  } catch (error) { inspection = { id, values: null, config: account.fp, at: new Date().toISOString(), url: inspectedURL, error: error.message }; }
  finally { clearTimeout(timer); }
  pushState(); return inspection;
}
async function exportReport(id = currentId) {
  const snapshot = await inspectInstance(id);
  if (snapshot.error) throw new Error(snapshot.error);
  const account = loadAccounts().find(item => item.id === id);
  const report = { formatVersion: 1, createdAt: snapshot.at, account: { id, name: account.name }, versions: getState().versions,
    configuration: snapshot.config, observed: snapshot.values, note: '实际读数快照；不代表第三方检测通过。未请求摄像头或麦克风权限。' };
  const directory = exportDirectory || path.resolve(__dirname, '..', 'exports');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `fingerprint-${id.slice(0, 8)}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8'); latestExport = file;
  pushState(); return { path: file, report };
}

function registerIPC() {
  ipcMain.removeAllListeners('switch-account');
  ipcMain.on('switch-account', (event, id) => { try { requireTrusted(event); showAccount(win, id); } catch {} });
  handle('get-accounts', () => safeAccounts()); handle('get-state', () => getState());
  handle('set-layout', mode => { if (!['single', 'compare'].includes(mode)) throw new Error('无效布局。'); layout = mode; layoutViews(); return getState(); });
  let pendingAdds = 0;
  handle('add-account', async (partial = {}) => {
    if (views.size + pendingAdds >= MAX_INSTANCES) throw new Error(`最多同时运行 ${MAX_INSTANCES} 个实例。`);
    pendingAdds++;
    try {
      if (!partial || typeof partial !== 'object') throw new Error('实例参数无效。');
      const name = typeof partial.name === 'string' ? partial.name.trim().slice(0, 48) : '';
      const url = displayURL(navigationURL(partial.url || DEFAULT_URL));
      const language = partial.language || 'en-US', timezone = partial.timezone || 'America/New_York';
      Intl.getCanonicalLocales(language); new Intl.DateTimeFormat('en', { timeZone: timezone });
      const fp = generateFingerprint({ language, timezone });
      if (partial.noise) for (const key of ['canvas', 'audio', 'rects']) if (typeof partial.noise[key] === 'boolean') fp.noise[key] = partial.noise[key];
      const account = addAccount({ name: name || `实例 ${views.size + 1}`, url, fp });
      await ensureAccountView(account); showAccount(win, account.id); pushState(true); automation.changed(); return account;
    } finally { pendingAdds--; }
  });
  handle('navigate', async (request = {}) => {
    const url = navigationURL(request.url), ids = request.all ? [...views.keys()] : [request.id || currentId];
    return Promise.all(ids.map(id => loadURL(id, url)));
  });
  handle('instance-action', (request = {}) => {
    const ids = request.all ? [...views.keys()] : [request.id || currentId];
    for (const id of ids) {
      const wc = views.get(id)?.webContents;
      if (!wc || wc.isDestroyed()) throw new Error('实例不存在。');
      switch (request.type) {
        case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
        case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
        case 'reload': runtime.get(id).error = null; wc.reload(); break;
        case 'stop': wc.stop(); break;
        case 'devtools': wc.openDevTools({ mode: 'detach' }); break;
        default: throw new Error('未知操作。');
      }
    }
    pushState(); return getState();
  });
  handle('inspect-instance', id => inspectInstance(id || currentId));
  handle('export-report', id => exportReport(id || currentId));
  handle('reveal-export', () => { if (latestExport) shell.showItemInFolder(latestExport); });
  handle('open-management', () => {
    if (management && !management.isDestroyed()) { management.show(); management.focus(); return; }
    management = createManagementWindow({ parent:win, automation, getProfiles:() => safeAccounts().map(({id,name}) => ({id,name})), currentId });
  });
}

async function startDemo({ show = true, defaultUrl = DEFAULT_URL, layout: initialLayout = 'single', exportDirectory: outputDirectory = null } = {}) {
  if (typeof session.defaultSession.setFingerprintConfig !== 'function') throw new Error('当前内核不支持指纹配置，请使用定制的 electron.exe。');
  closing = false; inspection = null; latestExport = null; layout = initialLayout; exportDirectory = outputDirectory;
  await startLocalServer();
  const accounts = seedDemoAccounts(defaultUrl);
  automation = new AutomationManager({ storageDir:path.join(app.getPath('userData'), 'automation'), getProfileIds:() => loadAccounts().map(item => item.id) });
  win = new BaseWindow({ width: 1500, height: 940, minWidth: 1060, minHeight: 720, show,
    title: 'FP Lab · 多实例指纹测试', backgroundColor: '#f3f5f8', autoHideMenuBar: true });
  sidebarView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'sidebar', 'preload.js') } });
  win.contentView.addChildView(sidebarView);
  sidebarView.webContents.on('will-navigate', event => event.preventDefault());
  sidebarView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  registerIPC();
  for (const account of accounts) await ensureAccountView(account);
  currentId = accounts[0]?.id || null; layoutViews(); win.on('resize', layoutViews);
  win.on('closed', () => {
    closing = true;
    if (management && !management.isDestroyed()) management.destroy();
    automation.dispose();
    for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    views.clear(); runtime.clear();
    if (!sidebarView.webContents.isDestroyed()) sidebarView.webContents.close();
    localServer?.close(); localServer = null; currentId = null;
  });
  await sidebarView.webContents.loadFile(shellPath); pushState(true);
  return { win, sidebarView, views, accounts, automation, get currentId() { return currentId; }, get localUrl() { return localUrl; }, getState };
}

function startStandalone() {
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
    app.whenReady().then(() => startDemo({ layout: 'compare' })).catch(error => { dialog.showErrorBox('启动失败', error.message); app.exit(1); });
  }
}
app.on('window-all-closed', () => app.quit());
module.exports = { startDemo, startStandalone };
