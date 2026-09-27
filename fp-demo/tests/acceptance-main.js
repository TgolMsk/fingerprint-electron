const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, session } = require('electron');

const stateRoot = process.env.FP_DEMO_TEST_STATE;
if (!stateRoot || !path.basename(stateRoot).startsWith('fp-demo-acceptance-')) throw new Error('An isolated acceptance userData is required');
app.setPath('userData', path.join(stateRoot, 'userData'));
// 等待窗口异步清理完成后保存报告，再由测试显式退出进程。
app.on('will-quit', (event) => event.preventDefault());
const phase = process.env.FP_DEMO_TEST_PHASE;
const resultRoot = process.env.FP_DEMO_TEST_RESULTS;
const baselineFile = path.join(stateRoot, 'baseline.json');
const { startDemo } = require('../src/main');
const checks = [];
const report = { phase, checks, versions: process.versions, userData: app.getPath('userData') };
const check = (name, condition, details) => {
  checks.push({ name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
};
const same = (actual, expected) => { try { assert.deepEqual(actual, expected); return true; } catch { return false; } };
const poll = async (read, accept, label) => {
  const deadline = Date.now() + 10000;
  do {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
};
const execute = (view, source) => view.webContents.executeJavaScript(source, true);
function saveReport() {
  report.passed = checks.length > 0 && checks.every((entry) => entry.passed) && !report.error;
  fs.writeFileSync(path.join(resultRoot, `${phase}.json`), JSON.stringify(report, null, 2));
}
const timeout = setTimeout(() => {
  report.error = 'Acceptance timed out after 120 seconds'; saveReport(); app.exit(2);
}, 120000);

app.whenReady().then(async () => {
  const demo = await startDemo({ show: false, defaultUrl: process.env.FP_DEMO_TEST_URL });
  const accounts = demo.accounts;
  check('exactly three seeded accounts', accounts.length === 3);
  check('three unique account IDs and seeds', new Set(accounts.map((a) => a.id)).size === 3 && new Set(accounts.map((a) => a.fp.seed)).size === 3);
  check('three different persistent sessions', new Set([...demo.views.values()].map((v) => v.webContents.session)).size === 3 && [...demo.views.values()].every((v) => v.webContents.session.isPersistent()));
  await Promise.all([...demo.views.values()].map((view) => view.ready));
  await poll(() => execute(demo.sidebarView, 'document.querySelectorAll(".item").length'), (n) => n === 3, 'sidebar rendered accounts under CSP');
  check('sidebar renders three accounts through real preload and IPC', true);
  check('first account active at startup', demo.currentId === accounts[0].id && await execute(demo.sidebarView, 'document.querySelectorAll(".item.active").length === 1'));
  const baseline = phase === 'restart' ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : { accounts, fingerprints: {}, tokens: {} };
  if (phase === 'restart') {
    check('account IDs and full saved fingerprint configs survive restart', same(accounts, baseline.accounts));
    check('legacy UA repaired and saved without changing seeds or other fields', same(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'accounts.json'), 'utf8')), baseline.accounts));
  }
  const loadTokens = {};
  const fingerprints = {};
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    const view = demo.views.get(account.id);
    const prefix = `account ${index + 1}`;
    loadTokens[account.id] = await execute(view, 'window.loadToken');
    const before = await execute(view, 'window.readState()');
    const token = account.id;
    if (phase === 'bootstrap') {
      check(`${prefix}: no cookie/localStorage/IndexedDB leakage from prior accounts`, same(before, { cookie: '', local: null, indexed: null }), before);
      await execute(view, `window.writeState(${JSON.stringify(token)})`);
    }
    const persisted = await execute(view, 'window.readState()');
    check(`${prefix}: own cookie/localStorage/IndexedDB ${phase === 'restart' ? 'survive restart' : 'stored'}`, same(persisted, { cookie: `account=${token}`, local: token, indexed: token }), persisted);
    const fp = await execute(view, 'window.collectFingerprint()');
    const again = await execute(view, 'window.collectFingerprint()');
    fingerprints[account.id] = fp;
    check(`${prefix}: repeated fingerprint reads are stable`, same(fp, again));
    check(`${prefix}: UA matches configured actual Chromium version`, fp.ua === account.fp.uaString && fp.ua.includes(`Chrome/${process.versions.chrome} `), { actual: fp.ua, configured: account.fp.uaString });
    check(`${prefix}: network UA and Accept-Language match page`, fp.headers.ua === fp.ua && fp.headers.language.split(',')[0].split(';')[0] === fp.languages[0], fp.headers);
    check(`${prefix}: navigator hardware/platform/languages match config`, same({ platform: fp.platform, hardwareConcurrency: fp.cores, deviceMemory: fp.memory, languages: fp.languages }, account.fp.navigator));
    check(`${prefix}: worker matches page fingerprint`, same(fp.worker, { ua: fp.ua, platform: fp.platform, cores: fp.cores, memory: fp.memory, languages: fp.languages }), fp.worker);
    check(`${prefix}: screen and timezone match config`, same(fp.screen, account.fp.screen) && fp.timezone === account.fp.timezone, { screen: fp.screen, timezone: fp.timezone });
    check(`${prefix}: WebGL vendor/renderer match config`, same(fp.webgl, account.fp.webgl), fp.webgl);
    if (phase === 'restart') {
      check(`${prefix}: fingerprint including canvas/audio survives process restart`, same(fp, baseline.fingerprints[account.id]));
      check(`${prefix}: a new renderer page was loaded after restart`, loadTokens[account.id] !== baseline.tokens[account.id]);
    }
  }
  check('three distinct canvas fingerprints', new Set(Object.values(fingerprints).map((fp) => fp.canvas)).size === 3);
  check('three distinct audio fingerprints', new Set(Object.values(fingerprints).map((fp) => fp.audio)).size === 3);
  for (const index of [1, 2, 0]) {
    const account = accounts[index];
    await execute(demo.sidebarView, `document.querySelectorAll('.item')[${index}].click()`);
    await poll(async () => demo.currentId, (id) => id === account.id, 'sidebar switches account');
    check(`switch to account ${index + 1}: correct view and sidebar active`, [...demo.views].every(([id, view]) => view.getVisible() === (id === account.id)) && await execute(demo.sidebarView, `document.querySelectorAll('.item')[${index}].classList.contains('active')`));
    const view = demo.views.get(account.id);
    check(`switch to account ${index + 1}: page remains loaded and state isolated`, await execute(view, 'window.loadToken') === loadTokens[account.id] && same(await execute(view, 'window.readState()'), { cookie: `account=${account.id}`, local: account.id, indexed: account.id }));
  }
  await execute(demo.sidebarView, 'window.fpDemo.switchAccount("missing-account")');
  await execute(demo.sidebarView, 'window.fpDemo.getAccounts()');
  check('invalid account switch preserves active view', demo.currentId === accounts[0].id && demo.views.get(accounts[0].id).getVisible());
  for (const view of demo.views.values()) {
    const accountSession = view.webContents.session;
    accountSession.flushStorageData();
    await accountSession.cookies.flushStore();
  }
  check('default session has no account cookies', (await session.defaultSession.cookies.get({ url: process.env.FP_DEMO_TEST_URL })).length === 0);
  if (phase === 'bootstrap') {
    baseline.fingerprints = fingerprints; baseline.tokens = loadTokens;
    fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));
  }
  report.accountIds = accounts.map((account) => account.id);
  report.fingerprints = fingerprints;
  const contents = [...demo.views.values()].map((view) => view.webContents).concat(demo.sidebarView.webContents);
  demo.win.close();
  await poll(async () => contents.every((contents) => contents.isDestroyed()), Boolean, 'all WebContentsView contents close');
  check('closing BaseWindow destroys all account and sidebar webContents', true);
  saveReport();
  clearTimeout(timeout);
  app.exit(report.passed ? 0 : 1);
}).catch((error) => {
  report.error = error.stack; console.error(error); saveReport(); clearTimeout(timeout); app.exit(1);
});
