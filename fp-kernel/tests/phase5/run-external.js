// Read-only public detector collection. Run with the custom Electron executable.
// This script never logs into a site, solves a challenge, or changes page APIs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, session } = require('electron');

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(process.env.FP_PHASE5_OUTPUT || path.join(__dirname, '../../reports/phase5', runId));
fs.mkdirSync(output, { recursive: true });
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-phase5-'));
app.setPath('userData', path.join(stateRoot, 'userData'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
const windows = [];
const manifest = {
  startedAt: new Date().toISOString(), output, stateRoot,
  executable: process.execPath, executableModifiedAt: fs.statSync(process.execPath).mtime.toISOString(),
  sourceRevisionReportedByBuild: process.env.FP_PHASE5_REVISION || null,
  versions: process.versions, label: process.env.FP_PHASE5_LABEL || 'preliminary',
  settings: { directConnection: true, plugins: true, visibleWindow: false, sandbox: true, contextIsolation: true, nodeIntegration: false, permissions: 'denied; no microphone, camera or local-fonts permission granted' },
  realChrome152Comparison: 'NOT TESTED: no matching real Chrome 152 executable supplied',
  results: [],
};
const write = (file, data) => fs.writeFileSync(path.join(output, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const save = () => write('manifest.json', manifest);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bounded = (promise, ms, label) => Promise.race([promise, pause(ms).then(() => { throw new Error(`${label}: timed out after ${ms} ms`); })]);

function config(index) {
  const chrome = process.versions.chrome;
  return {
    schemaVersion: 1, seed: ['a100000000000001', 'b200000000000002', 'c300000000000003'][index],
    uaString: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`,
    ua: { brand: 'Google Chrome', fullVersion: chrome, platform: 'Windows', platformVersion: index === 1 ? '10.0.0' : '15.0.0', arch: 'x86', bitness: '64' },
    navigator: { platform: 'Win32', hardwareConcurrency: [8, 12, 16][index], deviceMemory: 8, languages: ['en-US', 'en'] },
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, dpr: 1 },
    webgl: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    timezone: 'America/New_York', fonts: 'win-default', noise: { canvas: true, audio: true, rects: true }, disable: [],
  };
}

const probe = ` (async () => {
  const describe = (obj, key) => {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    return d && { enumerable: d.enumerable, configurable: d.configurable, writable: d.writable, get: d.get && String(d.get), set: d.set && String(d.set), type: typeof d.value };
  };
  const chrome = window.chrome;
  const out = {
    url: location.href, title: document.title, readyState: document.readyState,
    ua: navigator.userAgent, platform: navigator.platform, languages: navigator.languages,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory, maxTouchPoints: navigator.maxTouchPoints,
    webdriver: navigator.webdriver, pdfViewerEnabled: navigator.pdfViewerEnabled,
    plugins: Array.from(navigator.plugins, p => ({ name: p.name, filename: p.filename, description: p.description, mimeTypes: Array.from(p, m => ({ type: m.type, suffixes: m.suffixes, description: m.description })) })),
    mimeTypes: Array.from(navigator.mimeTypes, m => ({ type: m.type, suffixes: m.suffixes, plugin: m.enabledPlugin && m.enabledPlugin.name })),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth, devicePixelRatio },
    window: { innerWidth, innerHeight, outerWidth, outerHeight },
    chrome: chrome && { keys: Object.keys(chrome), descriptor: describe(window, 'chrome'), functions: Object.fromEntries(['loadTimes','csi'].map(k => [k,{ source: String(chrome[k]), name: chrome[k]?.name, length: chrome[k]?.length, descriptor: describe(chrome,k), result: typeof chrome[k] === 'function' ? chrome[k]() : null }])), appKeys: chrome.app && Object.keys(chrome.app), appDescriptors: chrome.app && Object.fromEntries(Object.keys(chrome.app).map(k => [k, describe(chrome.app,k)])), appFunctionSources: chrome.app && Object.fromEntries(Object.keys(chrome.app).filter(k => typeof chrome.app[k] === 'function').map(k => [k, String(chrome.app[k])])), installState: chrome.app && chrome.app.InstallState, runningState: chrome.app && chrome.app.RunningState },
    voices: speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, localService: v.localService, default: v.default })),
  };
  try { out.uaData = navigator.userAgentData && await navigator.userAgentData.getHighEntropyValues(['architecture','bitness','model','platformVersion','fullVersionList','wow64']); } catch(e) { out.uaDataError = String(e); }
  try { out.media = await Promise.race([navigator.mediaDevices.enumerateDevices().then(ds => ds.map(d => ({kind:d.kind, label:d.label, deviceId:d.deviceId, groupId:d.groupId}))), new Promise(r => setTimeout(() => r({error:'timeout'}),4000))]); } catch(e) { out.mediaError = String(e); }
  return out;
})()`;

async function collect(site, index) {
  const id = `${site.id}-account-${index + 1}`;
  const result = { id, site: site.url, account: index + 1, startedAt: new Date().toISOString(), status: 'RUNNING', console: [], loadErrors: [], failedRequests: [], permissionRequests: [] };
  manifest.results.push(result); save();
  const ses = session.fromPartition(`persist:phase5-${id}`);
  await ses.setProxy({ mode: 'direct' });
  const fp = config(index);
  ses.setUserAgent(fp.uaString, fp.navigator.languages.join(','));
  ses.setFingerprintConfig(JSON.stringify(fp));
  ses.setPermissionRequestHandler((_contents, permission, callback) => { result.permissionRequests.push(permission); callback(false); });
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onErrorOccurred((details) => { result.failedRequests.push({ url: details.url, resourceType: details.resourceType, error: details.error }); });
  const win = new BrowserWindow({ width: 1440, height: 1100, useContentSize: true, show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true, backgroundThrottling: false } });
  windows.push(win);
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => { result.console.push({ level, message, line, sourceId }); });
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => { result.loadErrors.push({ code, description, validatedURL, isMainFrame }); });
  win.webContents.on('render-process-gone', (_event, details) => { result.rendererFailure = details; });
  try {
    await bounded(win.loadURL(site.url), 45000, 'navigation');
    result.navigation = 'LOADED';
    // Both public pages run asynchronous tests; retain a full settled DOM snapshot.
    await pause(Number(process.env.FP_PHASE5_SETTLE_MS || 45000));
    const snapshot = await bounded(win.webContents.executeJavaScript(`({ title:document.title, url:location.href, readyState:document.readyState, text:document.body.innerText, rows:Array.from(document.querySelectorAll('tr'),r=>({text:r.innerText,classes:r.className,cells:Array.from(r.children,c=>({text:c.innerText,classes:c.className,id:c.id}))})), flaggedElements:Array.from(document.querySelectorAll('.failed,.fail,.passed,.pass,.warn,.warning'),e=>({tag:e.tagName,id:e.id,classes:e.className,text:e.innerText})), headings:Array.from(document.querySelectorAll('h1,h2,h3'),e=>e.innerText)})`), 15000, 'DOM collection');
    result.pageTitle = snapshot.title;
    result.finalUrl = snapshot.url;
    result.textLength = snapshot.text.length;
    write(`${id}.page.json`, snapshot);
    write(`${id}.txt`, snapshot.text);
    result.probe = await bounded(win.webContents.executeJavaScript(probe), 15000, 'API probe');
    write(`${id}.probe.json`, result.probe);
    write(`${id}.config.json`, fp);
    const image = await bounded(win.webContents.capturePage(), 15000, 'screenshot');
    fs.writeFileSync(path.join(output, `${id}.png`), image.toPNG());
    if (site.id === 'creepjs') {
      const positions = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[id]')).filter(e=>/^(headless|lies|trash|errors|bot-detection)/i.test(e.id)).slice(0,6).map(e=>({id:e.id,top:e.getBoundingClientRect().top+scrollY}))`);
      result.screenshotSections = positions;
      for (const section of positions) {
        await win.webContents.executeJavaScript(`scrollTo(0,${Math.max(0,section.top-30)})`);
        await pause(200);
        const sectionImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(output, `${id}-${section.id.replace(/[^a-z0-9_-]/gi,'_')}.png`), sectionImage.toPNG());
      }
    }
    result.status = snapshot.text.length > 50 ? 'COLLECTED' : 'INCOMPLETE_PAGE';
    if (site.id === 'sannysoft') {
      result.failedRows = snapshot.rows.filter(r => r.cells.some(c => /\b(failed|fail)\b/.test(c.classes)));
      result.warnRows = snapshot.rows.filter(r => r.cells.some(c => /\b(warn|warning)\b/.test(c.classes)));
      result.passedRows = snapshot.rows.filter(r => r.cells.some(c => /\b(passed|pass)\b/.test(c.classes)));
      result.externalVerdict = result.failedRows.length ? 'FAILURES_OBSERVED' : result.passedRows.length >= 31 && result.warnRows.length === 0 ? 'OBSERVED_CHECKS_PASSED' : 'INCOMPLETE_OR_REQUIRES_REVIEW';
    } else {
      // CreepJS emits its own full JSON result to the browser console. Preserve
      // that result rather than inferring a pass from the visible score alone.
      for (const entry of result.console.filter(entry => entry.message.startsWith('diff check'))) {
        try {
          const fingerprint = JSON.parse(entry.message.slice(entry.message.indexOf('{')));
          if (!fingerprint.lies || !fingerprint.headless) continue;
          write(`${id}.fingerprint.json`, fingerprint);
          result.creepjs = {
            lies: fingerprint.lies, trash: fingerprint.trash, capturedErrors: fingerprint.capturedErrors,
            headless: fingerprint.headless,
          };
        } catch (error) { result.parseError = error.message; }
      }
      result.externalVerdict = result.creepjs ? result.creepjs.lies.totalLies > 0 ? 'LIES_OBSERVED' : 'NO_LIES_IN_SITE_RESULT' : 'INCOMPLETE_OR_REQUIRES_REVIEW';
    }
  } catch (error) {
    result.error = error.stack;
    result.status = result.navigation ? 'COLLECTION_FAILED' : 'SITE_UNREACHABLE_OR_NAVIGATION_FAILED';
    try { fs.writeFileSync(path.join(output, `${id}-error.png`), (await win.webContents.capturePage()).toPNG()); } catch (_) { /* retain original error */ }
  }
  result.finishedAt = new Date().toISOString();
  save();
  console.log(`${id}: ${result.status}; ${result.externalVerdict || result.error}`);
}

const deadline = setTimeout(() => { manifest.error = 'Global 8 minute timeout'; save(); app.exit(2); }, 480000);
app.whenReady().then(async () => {
  if (typeof session.defaultSession.setFingerprintConfig !== 'function') throw new Error('Custom fingerprint kernel is required');
  manifest.executableSha256 = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(process.execPath);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
  const sites = [{ id: 'creepjs', url: 'https://abrahamjuliot.github.io/creepjs/' }, { id: 'sannysoft', url: 'https://bot.sannysoft.com/' }];
  const accountCount = Math.min(3, Math.max(1, Number(process.env.FP_PHASE5_ACCOUNTS || 1)));
  for (let index = 0; index < accountCount; index++) await Promise.all(sites.map(site => collect(site, index)));
  manifest.finishedAt = new Date().toISOString(); save();
  clearTimeout(deadline);
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  console.log(`Evidence: ${output}`);
  app.exit(manifest.results.every(r => r.status === 'COLLECTED') ? 0 : 1);
}).catch(error => { manifest.error = error.stack; save(); clearTimeout(deadline); console.error(error); app.exit(2); });
