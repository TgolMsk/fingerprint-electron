const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow, desktopCapturer } = require('electron');

const stateRoot = process.env.FP_TESTER_STATE;
const resultRoot = process.env.FP_TESTER_RESULTS;
const fixtureUrl = process.env.FP_TESTER_FIXTURE;
if (!stateRoot || !path.basename(stateRoot).startsWith('fp-demo-tester-') || !resultRoot || !fixtureUrl) {
  throw new Error('Run through run-tester.js with isolated test state');
}
app.setPath('userData', path.join(stateRoot, 'userData'));
app.on('will-quit', (event) => event.preventDefault());
const { startDemo } = require('../src/main');
const checks = [];
const report = { startedAt: new Date().toISOString(), versions: process.versions, userData: app.getPath('userData'), checks, screenshots: [] };
let demo;
let attacker;
const check = (name, passed, details) => {
  checks.push({ name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
};
const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const execute = (view, source) => view.webContents.executeJavaScript(source, true);
const shell = (source) => execute(demo.sidebarView, source);
const bridge = (method, ...args) => shell(`window.fpDemo[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
const poll = async (read, accepts, label, milliseconds = 20000) => {
  const deadline = Date.now() + milliseconds;
  let last;
  do {
    last = await read();
    if (accepts(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 75));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(last)}`);
};
const readyAt = async (view, url) => poll(async () => {
  if (view.webContents.isLoadingMainFrame() || view.webContents.getURL() !== url) return false;
  try { return await execute(view, 'document.readyState === "complete"'); } catch { return false; }
}, Boolean, `page load ${url}`);
const capture = async (view, name) => {
  const file = path.join(resultRoot, name);
  const wasVisible = demo.win.isVisible();
  if (!wasVisible) {
    // A hidden BaseWindow has no compositor surface. Show without taking focus
    // only long enough to capture the real rendered UI, then restore its state.
    demo.win.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    const screenshot = await view.webContents.capturePage();
    if (screenshot.isEmpty()) throw new Error(`Empty screenshot ${name}`);
    fs.writeFileSync(file, screenshot.toPNG()); report.screenshots.push(file);
  } finally { if (!wasVisible) demo.win.hide(); }
};
const boundsFit = (bounds, width, height) => bounds && bounds.width > 0 && bounds.height > 0 && bounds.x >= 260 && bounds.y >= 88 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height;
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function saveReport() {
  report.finishedAt = new Date().toISOString();
  report.passed = checks.length > 0 && checks.every((entry) => entry.passed) && !report.error;
  fs.writeFileSync(path.join(resultRoot, 'tester.json'), JSON.stringify(report, null, 2));
}
const watchdog = setTimeout(() => {
  report.error = 'Tester exceeded 165 seconds'; saveReport(); app.exit(2);
}, 165000);

async function main() {
  demo = await startDemo({ show: false, layout: 'compare', exportDirectory: path.join(resultRoot, 'exports') });
  await Promise.all([...demo.views.values()].map((view) => view.ready));
  await poll(() => shell('Boolean(window.fpDemo && document.querySelectorAll(".item").length === 3)'), Boolean, 'three shell instance controls');
  const accounts = demo.accounts;
  const ids = accounts.map((account) => account.id);
  check('three independent instances launch with unique persistent sessions and seeds', accounts.length === 3 && new Set(ids).size === 3 && new Set(accounts.map((account) => account.fp.seed)).size === 3 && new Set([...demo.views.values()].map((view) => view.webContents.session)).size === 3 && [...demo.views.values()].every((view) => view.webContents.session.isPersistent()));
  check('default URL resolves to the bundled loopback fingerprint page', /^http:\/\/127\.0\.0\.1:\d+\//.test(demo.localUrl) && [...demo.views.values()].every((view) => view.webContents.getURL() === demo.localUrl), { localUrl: demo.localUrl });
  const initialState = await bridge('getState');
  report.initialState = initialState;
  check('compare layout exposes all three real browser views', initialState.layout === 'compare' && initialState.instances.length === 3 && initialState.instances.every((instance) => instance.visible));
  verifyLayout('initial compare', initialState);
  await Promise.all(ids.map((id) => poll(() => execute(demo.views.get(id), 'Boolean(window.fingerprintResult && document.querySelectorAll("#summary .summary-item").length === 3)'), Boolean, 'bundled page automatic fingerprint report')));
  await capture(demo.sidebarView, 'shell-compare.png');
  await capture(demo.views.get(ids[0]), 'local-fingerprint.png');
  await captureWindow();
  report.localClipboardPermission = await execute(demo.views.get(ids[0]), '(async () => { try { return (await navigator.permissions.query({name:"clipboard-write"})).state; } catch(error) { return String(error); } })()');
  check('local fingerprint page allows writing sanitized text on user request', report.localClipboardPermission === 'granted', { state: report.localClipboardPermission });

  const snapshots = [];
  for (const [index, account] of accounts.entries()) {
    const snapshot = await bridge('inspect', account.id);
    const repeated = await bridge('inspect', account.id);
    snapshots.push(snapshot);
    check(`instance ${index + 1}: inspector returns actual browser probe and stored config`, snapshot.id === account.id && Boolean(snapshot.values) && same(snapshot.config, account.fp) && !snapshot.error, snapshot.error || undefined);
    const measured = snapshot.values;
    const nav = measured?.navigator?.data || {};
    check(`instance ${index + 1}: actual navigator, timezone, and GPU agree with saved configuration`,
      nav.userAgent === account.fp.uaString && nav.platform === account.fp.navigator.platform && nav.hardwareConcurrency === account.fp.navigator.hardwareConcurrency && nav.deviceMemory === account.fp.navigator.deviceMemory && same(nav.languages, account.fp.navigator.languages) && measured.intl?.data?.dateTime?.timeZone === account.fp.timezone && measured.webgl?.data?.unmaskedVendor === account.fp.webgl.vendor && measured.webgl?.data?.unmaskedRenderer === account.fp.webgl.renderer);
    const digests = (values) => ({ canvas: values?.canvas?.data?.pixelHash?.value, audio: values?.audio?.data?.hash?.value, rects: values?.rects?.data?.hash?.value, textMetrics: values?.textMetrics?.data?.hash?.value });
    check(`instance ${index + 1}: Canvas, Audio, Rects, and font summaries are present and repeatable`, Object.values(digests(measured)).every((value) => typeof value === 'string' && value.length > 0) && same(digests(measured), digests(repeated.values)), { first: digests(measured), repeated: digests(repeated.values) });
    const pageResult = await execute(demo.views.get(account.id), 'window.fingerprintResult');
    check(`instance ${index + 1}: page renders the same real probe summaries as inspector`, same(digests(pageResult), digests(measured)));
    check(`instance ${index + 1}: account page has no privileged preload or Node globals`, await execute(demo.views.get(account.id), '[typeof window.fpDemo, typeof require, typeof process].every(value => value === "undefined")'));
    report[`inspection${index + 1}`] = snapshot;
    report[`repeat${index + 1}`] = repeated;
  }
  for (const [section, key] of [['canvas', 'pixelHash'], ['audio', 'hash'], ['rects', 'hash']]) {
    check(`three independent seeds produce three distinct ${section} summaries`, new Set(snapshots.map((snapshot) => snapshot.values?.[section]?.data?.[key]?.value)).size === 3);
  }

  // Each account retains its renderer and independent storage when switching layouts.
  const tokens = {};
  for (const id of ids) {
    tokens[id] = await execute(demo.views.get(id), `(() => { const token = crypto.randomUUID(); window.testerLoadToken = token; localStorage.setItem('tester-account', ${JSON.stringify(id)}); return token; })()`);
  }
  await shell('document.getElementById("layout-single").click()');
  await poll(() => bridge('getState'), (state) => state.layout === 'single', 'single layout control');
  for (const index of [1, 2, 0]) {
    await shell(`document.querySelectorAll('.item')[${index}].click()`);
    await poll(() => demo.currentId, (id) => id === ids[index], 'switch current instance');
    const state = await bridge('getState');
    check(`single layout switch ${index + 1}: one correct visible view`, state.instances.filter((instance) => instance.visible).length === 1 && state.instances.find((instance) => instance.id === ids[index]).visible);
    check(`single layout switch ${index + 1}: no reload or localStorage loss`, await execute(demo.views.get(ids[index]), `window.testerLoadToken === ${JSON.stringify(tokens[ids[index]])} && localStorage.getItem('tester-account') === ${JSON.stringify(ids[index])}`));
  }
  await capture(demo.sidebarView, 'shell-single.png');

  const activeId = ids[0];
  const active = demo.views.get(activeId);
  const rejectedScriptURL = await shell('(async () => { try { await window.fpDemo.navigate({url:"javascript:window.location.href=\\"https://example.com\\""}); return false; } catch { return true; } })()');
  check('address validation rejects executable URLs without replacing the active page', rejectedScriptURL && active.webContents.getURL() === demo.localUrl);
  const oneUrl = `${fixtureUrl}/one`;
  const twoUrl = `${fixtureUrl}/two`;
  await enterAddress(oneUrl);
  await readyAt(active, oneUrl);
  report.externalClipboardPermission = await execute(active, '(async () => { try { return (await navigator.permissions.query({name:"clipboard-write"})).state; } catch(error) { return String(error); } })()');
  check('external pages do not receive local clipboard permissions', report.externalClipboardPermission === 'denied', { state: report.externalClipboardPermission });
  check('address navigation changes only the selected instance', ids.slice(1).every((id) => demo.views.get(id).webContents.getURL() === demo.localUrl));
  await execute(active, `localStorage.setItem('tester-account', ${JSON.stringify(activeId)})`);
  await enterAddress(twoUrl);
  await readyAt(active, twoUrl);
  await clickControl('back');
  await readyAt(active, oneUrl);
  check('back returns to the previous entered URL', active.webContents.getURL() === oneUrl);
  await clickControl('forward');
  await readyAt(active, twoUrl);
  check('forward returns to the next entered URL', active.webContents.getURL() === twoUrl);
  const beforeReload = await execute(active, 'window.loadToken');
  await clickControl('reload');
  await poll(async () => { try { return await execute(active, 'window.loadToken'); } catch { return undefined; } }, (value) => Boolean(value) && value !== beforeReload, 'reload creates a new page');
  check('reload creates a new renderer document while preserving localStorage', await execute(active, `localStorage.getItem('tester-account') === ${JSON.stringify(activeId)}`));

  const allUrl = `${fixtureUrl}/all`;
  await enterAddress(allUrl, true);
  await Promise.all(ids.map((id) => readyAt(demo.views.get(id), allUrl)));
  check('navigate all loads the entered URL in every instance', ids.every((id) => demo.views.get(id).webContents.getURL() === allUrl));
  check('external fixture storage remains isolated per session', await execute(demo.views.get(ids[1]), 'localStorage.getItem("tester-account") === null') && await execute(demo.views.get(ids[2]), 'localStorage.getItem("tester-account") === null'));
  const geometryBeforeHostStyle = await bridge('inspect', activeId);
  await execute(active, `(() => { const style = document.createElement('style'); style.id = 'hostile-host-style'; style.textContent = 'div { display:none!important; transform:scale(2)!important } html { direction:rtl }'; document.head.append(style); })()`);
  const geometryWithHostStyle = await bridge('inspect', activeId);
  await execute(active, 'document.getElementById("hostile-host-style").remove()');
  check('remote-site global styles and RTL do not contaminate fixed Rects measurements', geometryBeforeHostStyle.values?.rects?.data?.hash?.value && geometryBeforeHostStyle.values.rects.data.hash.value === geometryWithHostStyle.values?.rects?.data?.hash?.value, { before: geometryBeforeHostStyle.values?.rects, after: geometryWithHostStyle.values?.rects });

  await shell(`(() => {
    document.getElementById('add-settings').open = true;
    document.getElementById('new-name').value = '验收实例 4';
    document.getElementById('new-language').value = 'zh-CN';
    document.getElementById('new-timezone').value = 'Asia/Shanghai';
    for (const key of ['canvas', 'audio', 'rects']) document.getElementById('noise-' + key).checked = true;
    document.getElementById('add').click();
  })()`);
  await poll(() => demo.views.size, (size) => size === 4, 'fourth instance creation');
  const added = (await bridge('getState')).accounts.find((account) => !ids.includes(account.id));
  await demo.views.get(added.id).ready;
  const fourth = await bridge('inspect', added.id);
  check('fourth instance is selected with a new unique seed and requested locale', demo.currentId === added.id && !ids.includes(added.id) && !accounts.some((account) => account.fp.seed === fourth.config.seed) && fourth.config.navigator.languages[0] === 'zh-CN' && fourth.config.timezone === 'Asia/Shanghai');
  check('fourth instance browser observes requested language and timezone', await execute(demo.views.get(added.id), 'navigator.language === "zh-CN" && Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Shanghai"'));
  check('selecting the new instance updates the focused address bar to its actual page', await shell('document.getElementById("url").value') === 'fp-test://local/');
  await poll(() => shell('document.querySelectorAll(".item").length'), (count) => count === 4, 'fourth shell instance control');
  await shell('document.getElementById("layout-compare").click()');
  await poll(() => bridge('getState'), (state) => state.layout === 'compare', 'compare layout control');
  verifyLayout('four-instance compare', await bridge('getState'));
  demo.win.setContentSize(1120, 720);
  await poll(() => demo.win.getContentSize(), ([width, height]) => width === 1120 && height === 720, 'window resize');
  const resizedState = await poll(() => bridge('getState'), (state) => state.instances.every((instance) => boundsFit(instance.bounds, 1120, 720)), 'resize updates all embedded view bounds');
  verifyLayout('resized compare', resizedState);
  await capture(demo.sidebarView, 'shell-four-instances.png');

  const exported = await bridge('exportReport', added.id);
  const exportRoot = path.resolve(resultRoot, 'exports');
  const relativeExport = path.relative(exportRoot, exported.path);
  check('export report writes a JSON file inside the explicit test export directory', Boolean(relativeExport) && !relativeExport.startsWith('..') && !path.isAbsolute(relativeExport) && fs.existsSync(exported.path), { path: exported.path });
  const exportedReport = JSON.parse(fs.readFileSync(exported.path, 'utf8'));
  report.exportSerialization = serializationDifferences(exported.report, exportedReport);
  check('JSON serialization only normalizes signed zero alphabetic baselines', report.exportSerialization.every((difference) => difference.path.endsWith('.alphabeticBaseline') && difference.before === '-0' && difference.after === '0'), report.exportSerialization);
  check('exported report contains actual probe results and matches the returned report', same(exportedReport, JSON.parse(JSON.stringify(exported.report))) && JSON.stringify(exportedReport).includes(fourth.config.seed));
  report.exportPath = exported.path;

  const beforeInspect = (await bridge('getState')).inspection?.at;
  await clickControl('inspect');
  await poll(() => bridge('getState'), (state) => state.inspection && state.inspection.id === added.id && state.inspection.at !== beforeInspect, 'inspect button');
  check('inspector button publishes the selected instance snapshot', (await bridge('getState')).inspection.id === added.id);
  await clickControl('export');
  const exportedByButton = await poll(() => bridge('getState'), (state) => Boolean(state.latestExport) && state.latestExport !== exported.path, 'export button');
  check('export button creates a reviewable report file', fs.existsSync(exportedByButton.latestExport));

  await clickControl('open-management');
  const managementWindow = await poll(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/manage/index.html')), Boolean, 'script and extension manager opens');
  const managementState = await poll(() => managementWindow.webContents.executeJavaScript("window.fpManagement?.invoke('state')"), state => state?.profiles?.length === 4, 'management profiles');
  check('workbench opens script manager with all live instances and current selection', managementState.currentId === added.id);
  managementWindow.destroy();

  attacker = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, '..', 'src', 'sidebar', 'preload.js') } });
  await attacker.loadURL(`${fixtureUrl}/untrusted`);
  const attack = await attacker.webContents.executeJavaScript(`(async () => {
    const results = [];
    for (const [method, arg] of [['getState', undefined], ['navigate', {url: ${JSON.stringify(`${fixtureUrl}/hijacked`)}, all: true}], ['exportReport', ${JSON.stringify(added.id)}]]) {
      try { await window.fpDemo[method](arg); results.push({method, rejected: false}); }
      catch (error) { results.push({method, rejected: true, error: String(error.message)}); }
    }
    return { bridgePresent: Boolean(window.fpDemo), results };
  })()`);
  check('untrusted sender cannot use privileged IPC even with a deliberately injected shell preload', attack.bridgePresent && attack.results.every((result) => result.rejected), attack);
  check('rejected external navigation preserves the selected instance URL', demo.views.get(added.id).webContents.getURL() === demo.localUrl);
  attacker.destroy(); attacker = null;

  const contents = [...demo.views.values()].map((view) => view.webContents).concat(demo.sidebarView.webContents);
  demo.win.close();
  await poll(() => contents.every((contents) => contents.isDestroyed()), Boolean, 'destroy all shell and account contents');
  check('closing the shell destroys every embedded browser instance', true);
}

async function enterAddress(url, all = false) {
  await shell(`(() => {
    const input = document.getElementById('url');
    input.focus(); input.value = ${JSON.stringify(url)};
    input.dispatchEvent(new Event('input', {bubbles: true}));
    ${all ? "document.getElementById('open-all').click();" : "document.getElementById('navigation-form').requestSubmit();"}
  })()`);
}

async function clickControl(id) {
  await poll(() => shell(`Boolean(document.getElementById(${JSON.stringify(id)}) && !document.getElementById(${JSON.stringify(id)}).disabled)`), Boolean, `${id} control becomes enabled`);
  await shell(`document.getElementById(${JSON.stringify(id)}).click()`);
}

async function captureWindow() {
  const wasVisible = demo.win.isVisible();
  try {
    if (!wasVisible) demo.win.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const targetId = demo.win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1800, height: 1200 }, fetchWindowIcons: false });
    const target = sources.find((source) => source.id === targetId);
    if (!target || target.thumbnail.isEmpty()) throw new Error('The test window thumbnail is unavailable');
    const file = path.join(resultRoot, 'workbench-window.png');
    fs.writeFileSync(file, target.thumbnail.toPNG()); report.screenshots.push(file);
  } catch (error) { report.windowCaptureError = error.message; }
  finally { if (!wasVisible) demo.win.hide(); }
}

function serializationDifferences(original, serialized, keyPath = '$') {
  if (Object.is(original, serialized)) return [];
  if (original && serialized && typeof original === 'object' && typeof serialized === 'object') {
    return [...new Set([...Object.keys(original), ...Object.keys(serialized)])].flatMap((key) => serializationDifferences(original[key], serialized[key], `${keyPath}.${key}`));
  }
  const describe = (value) => Object.is(value, -0) ? '-0' : value === undefined ? 'undefined' : Number.isNaN(value) ? 'NaN' : String(value);
  return [{ path: keyPath, before: describe(original), after: describe(serialized) }];
}

function verifyLayout(label, state) {
  const [width, height] = demo.win.getContentSize();
  const visible = state.instances.filter((instance) => instance.visible);
  check(`${label}: instance bounds fit the content area`, visible.every((instance) => boundsFit(instance.bounds, width, height)), { width, height, bounds: visible.map((instance) => instance.bounds) });
  check(`${label}: browser views never overlap`, visible.every((instance, index) => visible.slice(index + 1).every((other) => !overlap(instance.bounds, other.bounds))));
  check(`${label}: headers stay visible above their browser views`, visible.every((instance) => instance.headerBounds && instance.headerBounds.y + instance.headerBounds.height <= instance.bounds.y && instance.headerBounds.x === instance.bounds.x && instance.headerBounds.width === instance.bounds.width));
}

app.whenReady().then(main).catch((error) => { report.error = error.stack; console.error(error); }).finally(() => {
  if (attacker && !attacker.isDestroyed()) attacker.destroy();
  if (demo?.win && !demo.win.isDestroyed()) demo.win.close();
  saveReport(); clearTimeout(watchdog); app.exit(report.passed ? 0 : 1);
});
