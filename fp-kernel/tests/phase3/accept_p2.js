// fp_41/42/43 验收：rects 抖动、字体白名单、媒体设备与语音
// 运行：D:\e\src\out\Testing\electron.exe accept_p2.js
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const page = `<!doctype html><body><script>
(async () => {
  try {
  const out = {};
  const mark = (k) => { window.__step = k; };
  mark('start');
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;left:100px;top:50px;width:300px;height:150px;';
  document.body.appendChild(el);
  const r1 = el.getBoundingClientRect();
  const r2 = el.getBoundingClientRect();
  out.rect1 = [r1.x, r1.y, r1.width, r1.height];
  out.rect2 = [r2.x, r2.y, r2.width, r2.height];
  const range = document.createRange();
  range.selectNode(el);
  out.rangeRect = range.getBoundingClientRect().width;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '16px Arial';
  out.text1 = ctx.measureText('fingerprint-test').width;
  out.text2 = ctx.measureText('fingerprint-test').width;
  mark("fonts-start");
  out.fontArial = await document.fonts.check('16px Arial');
  out.fontCalibri = await document.fonts.check('16px Calibri');
  // 显式指定已知 fallback，避免机器默认字体恰好就是 Arial。
  // 白名单外字体应与"不存在字体"落到同一 fallback（宽度相等）；
  // 白名单内字体用真实字体渲染（宽度不同）
  out.wFira = ctx.measureText('mmmmiiiiwwww').width;
  ctx.font = '16px "Fira Code", "Courier New"';
  out.wFiraCode = ctx.measureText('mmmmiiiiwwww').width;
  ctx.font = '16px "DefinitelyNotInstalledXYZ", "Courier New"';
  out.wNotInstalled = ctx.measureText('mmmmiiiiwwww').width;
  ctx.font = '16px Arial, "Courier New"';
  out.wArial = ctx.measureText('mmmmiiiiwwww').width;
  try {
    mark("devices-start");
    const devs = await navigator.mediaDevices.enumerateDevices();
    out.devices = devs.map((d) => ({ kind: d.kind, label: d.label, id: d.deviceId.length, idp: d.deviceId, gid: d.groupId.length }));
  } catch (e) { out.devicesError = String(e); }
  try {
    mark("voices-start");
    const vs = speechSynthesis.getVoices();
    out.voices = vs.map((v) => ({ name: v.name, uri: v.voiceURI, lang: v.lang, dft: v.default, local: v.localService }));
  } catch (e) { out.voicesError = String(e); }
    window.__result = out;
  } catch (e) {
    window.__result = { fatal: String(e && e.stack || e) };
    return;
  }
})();
<\/script>`;

function makeConfig(seed) {
  return JSON.stringify({
    schemaVersion: 1,
    seed,
    navigator: { platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8, languages: ['en-US'] },
    fonts: 'win-default',
    noise: { canvas: true, audio: true, rects: true },
  });
}

const windows = [];

async function collect(id, port, seed) {
  const ses = session.fromPartition(`persist:p2-${id}`);
  await ses.setProxy({ mode: 'direct' });
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setFingerprintConfig(makeConfig(seed));
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  windows.push(win);
  win.webContents.on("render-process-gone", (_e, d) => console.log("[RENDERER GONE]", JSON.stringify(d)));
  await win.loadURL(`http://127.0.0.1:${port}/`);
  let r = null;
  for (let i = 0; i < 60; i++) {
    if (i % 12 === 11) console.log("[step]", await win.webContents.executeJavaScript("window.__step").catch(() => "?"));
    r = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__result || null)'));
    if (r) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  return r;
}

app.whenReady().then(async () => {
  const srv = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(page); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  global.__srv = srv;

  let failed = false;
  const check = (name, cond, detail = '') => {
    if (!cond) failed = true;
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  };

  const a = await collect('a', port, 'aaaaaaaaaaaaaaaa');
  const b = await collect('b', port, 'bbbbbbbbbbbbbbbb');
  const same = await collect('same-seed-new-renderer', port, 'aaaaaaaaaaaaaaaa');
  if (!a || !b) {
    console.log('FAIL collect');
    failed = true;
  } else if (a.fatal || b.fatal) {
    console.log('FAIL page exception:', a.fatal || b.fatal);
    failed = true;
  } else {
    check('rect 两次测量一致', JSON.stringify(a.rect1) === JSON.stringify(a.rect2), JSON.stringify(a.rect1));
    check('rect 账号间不同', JSON.stringify(a.rect1) !== JSON.stringify(b.rect1), `${a.rect1[0]} vs ${b.rect1[0]}`);
    check('rect 抖动幅度 < 1e-4', Math.abs(a.rect1[0] - 100) < 1e-4 && Math.abs(a.rect1[2] - 300) < 1e-4, `${a.rect1[0]},${a.rect1[2]}`);
    check('range 与 element rect 一致（同账号同抖动）', Math.abs(a.rangeRect - a.rect1[2]) < 1e-9, `${a.rangeRect} vs ${a.rect1[2]}`);
    check('measureText 两次一致', a.text1 === a.text2, `${a.text1} vs ${a.text2}`);
    check('measureText 账号间不同', a.text1 !== b.text1, `${a.text1} vs ${b.text1}`);
    check('白名单字体 Arial 可用（fonts.check）', a.fontArial === true);
    check('白名单字体 Calibri 可用（fonts.check）', a.fontCalibri === true);
    check('白名单外 Fira Code 与不存在字体同宽（走 fallback）', a.wFiraCode === a.wNotInstalled, `${a.wFiraCode} vs ${a.wNotInstalled}`);
    check('白名单内 Arial 与不存在字体不同宽（真字体渲染）', a.wArial !== a.wNotInstalled, `${a.wArial} vs ${a.wNotInstalled}`);
    check('同字体重复测量一致', a.wFira === a.wArial, `${a.wFira} vs ${a.wArial}`);
    const kinds = (a.devices || []).map((d) => d.kind).sort().join(',');
    check('设备集 = 2麦+1摄+2扬声器', kinds === 'audioinput,audioinput,audiooutput,audiooutput,videoinput', kinds);
    check('设备 label 为空（未授权形态）', (a.devices || []).every((d) => d.label === ''));
    check('设备 id 长度 64', (a.devices || []).every((d) => d.id === 64), JSON.stringify((a.devices || []).map((d) => d.id)));
    const bIds = JSON.stringify((b.devices || []).map((d) => [d.kind, d.idp]));
    const aIds = JSON.stringify((a.devices || []).map((d) => [d.kind, d.idp]));
    check('设备 id 账号间不同', aIds !== bIds);
    check('语音 = Windows 桌面三件套', (a.voices || []).length === 3 &&
      a.voices.some((v) => v.name.includes('David')) && a.voices.some((v) => v.name.includes('Zira')) && a.voices.some((v) => v.name.includes('Mark')),
      JSON.stringify((a.voices || []).map((v) => v.name)));
    check('语音 lang=en-US 且默认项正确', (a.voices || []).every((v) => v.lang === 'en-US') && (a.voices || []).filter((v) => v.dft).length === 1);
    check('语音 localService 全真', (a.voices || []).every((v) => v.local === true));
    check('语音 URI 与 Chromium 原生格式一致', a.voices.every(v => v.uri === v.name));
    check('同 seed 新 renderer 的几何/字体/媒体/语音一致', same && JSON.stringify(a) === JSON.stringify(same));
  }

  for (const w of windows) w.destroy();
  console.log(failed ? '=== FP_P2 ACCEPT: FAIL ===' : '=== FP_P2 ACCEPT: ALL PASS ===');
  app.exit(failed ? 1 : 0);
});
