// fp_31/40 验收：canvas/audio 确定性噪声
// 两个账号（不同 seed）：canvas/audio 哈希必须不同；
// 同一账号：多次读取完全一致；getImageData 与 toDataURL 像素一致。
// 运行：D:\e\src\out\Testing\electron.exe accept_noise.js
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const page = `<!doctype html><script>
(async () => {
  const out = {};
  // ---- canvas ----
  const draw = (c) => {
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f60'; ctx.fillRect(10, 10, 100, 50);
    const g = ctx.createLinearGradient(0, 0, 200, 100);
    g.addColorStop(0, '#123456'); g.addColorStop(1, '#fedcba');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = '#000'; ctx.font = '16px Arial';
    ctx.fillText('fp-noise 🌐', 20, 60);
    return ctx;
  };
  const fnv = (bytes) => {
    let h = 0x811c9dc5n;
    for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
    return h.toString(16);
  };
  const c1 = document.createElement('canvas'); c1.width = 200; c1.height = 100;
  const ctx1 = draw(c1);
  out.getImageData1 = fnv(ctx1.getImageData(0, 0, 200, 100).data);
  const c2 = document.createElement('canvas'); c2.width = 200; c2.height = 100;
  const ctx2 = draw(c2);
  out.getImageData2 = fnv(ctx2.getImageData(0, 0, 200, 100).data);
  const c3 = document.createElement('canvas'); c3.width = 200; c3.height = 100;
  draw(c3);
  const url1 = c3.toDataURL('image/png');
  out.dataUrl1 = fnv(Uint8Array.from(url1, (c) => c.charCodeAt(0)));
  const c4 = document.createElement('canvas'); c4.width = 200; c4.height = 100;
  draw(c4);
  const url2 = c4.toDataURL('image/png');
  out.dataUrl2 = fnv(Uint8Array.from(url2, (c) => c.charCodeAt(0)));
  // WebGL readPixels
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    gl.clearColor(0.2, 0.4, 0.6, 1.0); gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.glPixels = fnv(px);
  } catch (e) { out.glPixels = 'err:' + e; }
  // ---- audio ----
  try {
    const renderOnce = async () => {
      const ac = new OfflineAudioContext(1, 22050, 44100);
      const osc = ac.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ac.destination);
      osc.start();
      const buf = await ac.startRendering();
      const d = buf.getChannelData(0);
      const bytes = new Uint8Array(1000 * 4);
      new Float32Array(bytes.buffer).set(d.subarray(0, 1000));
      return fnv(bytes);
    };
    out.audio1 = await renderOnce();
    out.audio2 = await renderOnce();
  } catch (e) { out.audioError = String(e); }
  window.__result = out;
})();
<\/script>`;

function makeConfig(seed) {
  return JSON.stringify({
    schemaVersion: 1,
    seed,
    navigator: { platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8, languages: ['en-US'] },
    noise: { canvas: true, audio: true, rects: true },
  });
}

const windows = [];

async function collect(id, port, seed) {
  const ses = session.fromPartition(`persist:nz-${id}`);
  await ses.setProxy({ mode: 'direct' });
  ses.setFingerprintConfig(makeConfig(seed));
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  windows.push(win); // Testing 构建下"销毁后立即新建"会触发竞态，统一最后销毁
  await win.loadURL(`http://127.0.0.1:${port}/`);
  let r = null;
  for (let i = 0; i < 60; i++) {
    r = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__result || null)'));
    if (r) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  return r;
}

app.whenReady().then(async () => {
  const srv = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(page); });
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

  if (!a || !b) {
    console.log('FAIL collect');
    failed = true;
  } else {
    check('canvas 两次读取一致（账号A）', a.getImageData1 === a.getImageData2, `${a.getImageData1} vs ${a.getImageData2}`);
    check('canvas 账号间不同', a.getImageData1 !== b.getImageData1, `${a.getImageData1} vs ${b.getImageData1}`);
    check('toDataURL 两次一致（账号A）', a.dataUrl1 === a.dataUrl2, `${a.dataUrl1} vs ${a.dataUrl2}`);
    check('toDataURL 账号间不同', a.dataUrl1 !== b.dataUrl1, `${a.dataUrl1} vs ${b.dataUrl1}`);
    check('webgl readPixels 账号间不同', a.glPixels !== b.glPixels, `${a.glPixels} vs ${b.glPixels}`);
    check('audio 两次渲染一致（账号A）', a.audio1 === a.audio2, `${a.audio1} vs ${a.audio2}`);
    check('audio 账号间不同', a.audio1 !== b.audio1, `${a.audio1} vs ${b.audio1}`);
    check('audio 账号B 两次一致', b.audio1 === b.audio2);
    if (a.audioError) check('无 audio 错误', false, a.audioError);
  }

  for (const w of windows) w.destroy();
  console.log(failed ? '=== FP_NOISE ACCEPT: FAIL ===' : '=== FP_NOISE ACCEPT: ALL PASS ===');
  app.exit(failed ? 1 : 0);
});
