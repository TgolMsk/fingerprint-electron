// fp_11 验收：window.chrome 与真 Chrome 逐项一致
// 运行：D:\e\src\out\Testing\electron.exe accept_chrome_obj.js
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const page = `<!doctype html><script>
(async () => {
  const out = {};
  out.hasChrome = typeof window.chrome;
  out.keys = window.chrome ? Object.keys(window.chrome).sort() : [];
  out.loadTimesType = typeof chrome.loadTimes;
  out.csiType = typeof chrome.csi;
  out.appType = typeof chrome.app;
  out.loadTimesNative = /\\[native code\\]/.test(chrome.loadTimes.toString());
  out.csiNative = /\\[native code\\]/.test(chrome.csi.toString());
  out.loadTimesStr = chrome.loadTimes.toString();
  const lt = chrome.loadTimes();
  out.ltKeys = Object.keys(lt).sort();
  out.ltTypes = [typeof lt.requestTime, typeof lt.navigationType, typeof lt.wasNpnNegotiated].join(',');
  const csi = chrome.csi();
  out.csiKeys = Object.keys(csi).sort();
  out.csiTypes = [typeof csi.startE, typeof csi.pageT, typeof csi.tran].join(',');
  out.appKeys = Object.keys(chrome.app).sort();
  out.appIsInstalled = chrome.app.isInstalled;
  out.appGetIsInstalled = chrome.app.getIsInstalled();
  out.appGetDetails = chrome.app.getDetails();
  out.appRunningState = chrome.app.runningState();
  out.appInstallStateEnum = chrome.app.InstallState.NOT_INSTALLED;
  out.appRunningStateEnum = chrome.app.RunningState.CANNOT_RUN;
  out.appInstallStateAsync = await new Promise((res) => chrome.app.installState(res));
  window.__result = out;
})();
<\/script>`;

app.whenReady().then(async () => {
  const srv = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(page);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  global.__srv = srv;

  await session.defaultSession.setProxy({ mode: 'direct' });
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(`http://127.0.0.1:${port}/`);
  let r = null;
  for (let i = 0; i < 40; i++) {
    r = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__result || null)'));
    if (r) break;
    await new Promise((res) => setTimeout(res, 250));
  }

  let failed = false;
  const check = (name, cond, detail = '') => {
    if (!cond) failed = true;
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  };

  if (!r) {
    console.log('FAIL no result');
    failed = true;
  } else {
    check('window.chrome 是 object', r.hasChrome === 'object', r.hasChrome);
    check('chrome 顶层键 = app,csi,loadTimes', JSON.stringify(r.keys) === '["app","csi","loadTimes"]', r.keys.join(','));
    check('loadTimes/csi 是 function', r.loadTimesType === 'function' && r.csiType === 'function');
    check('loadTimes toString 为 native', r.loadTimesNative, r.loadTimesStr);
    check('csi toString 为 native', r.csiNative);
    const wantLt = ['commitLoadTime', 'connectionInfo', 'finishDocumentLoadTime', 'finishLoadTime', 'firstPaintAfterLoadTime', 'firstPaintTime', 'navigationType', 'npnNegotiatedProtocol', 'requestTime', 'startLoadTime', 'wasAlternateProtocolAvailable', 'wasFetchedViaSpdy', 'wasNpnNegotiated'].sort();
    check('loadTimes() 13 键齐全', JSON.stringify(r.ltKeys) === JSON.stringify(wantLt), r.ltKeys.join(','));
    check('loadTimes() 值类型', r.ltTypes === 'number,string,boolean', r.ltTypes);
    check('csi() 4 键', JSON.stringify(r.csiKeys) === '["onloadT","pageT","startE","tran"]', r.csiKeys.join(','));
    check('csi() 值类型', r.csiTypes === 'number,number,number', r.csiTypes);
    const wantApp = ['InstallState', 'RunningState', 'getDetails', 'getIsInstalled', 'installState', 'isInstalled', 'runningState'].sort();
    check('app 7 键', JSON.stringify(r.appKeys) === JSON.stringify(wantApp), r.appKeys.join(','));
    check('app.isInstalled === false', r.appIsInstalled === false);
    check('app.getIsInstalled() === false', r.appGetIsInstalled === false);
    check('app.getDetails() === null', r.appGetDetails === null);
    check('app.runningState() === cannot_run', r.appRunningState === 'cannot_run', r.appRunningState);
    check('app.InstallState.NOT_INSTALLED', r.appInstallStateEnum === 'not_installed', r.appInstallStateEnum);
    check('app.RunningState.CANNOT_RUN', r.appRunningStateEnum === 'cannot_run', r.appRunningStateEnum);
    check('app.installState(cb) 异步 not_installed', r.appInstallStateAsync === 'not_installed', String(r.appInstallStateAsync));
  }

  win.destroy();
  console.log(failed ? '=== FP_11 ACCEPT: FAIL ===' : '=== FP_11 ACCEPT: ALL PASS ===');
  app.exit(failed ? 1 : 0);
});
