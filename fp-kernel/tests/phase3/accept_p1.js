// fp_20/21/30 验收：navigator 硬件、屏幕、WebGL/WebGPU
// 运行：D:\e\src\out\Testing\electron.exe accept_p1.js
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const workerScript = `postMessage({ dm: navigator.deviceMemory, pf: navigator.platform, hc: navigator.hardwareConcurrency });`;
const mainPage = `<!doctype html><script>
(async () => {
  const out = {
    dm: navigator.deviceMemory,
    pf: navigator.platform,
    hc: navigator.hardwareConcurrency,
    sw: screen.width, sh: screen.height,
    saw: screen.availWidth, sah: screen.availHeight,
    cd: screen.colorDepth, pd: screen.pixelDepth, dpr: devicePixelRatio,
    mqWidth: matchMedia('(device-width: 1536px)').matches,
    mqHeight: matchMedia('(device-height: 864px)').matches,
    mqColor: matchMedia('(color: 8)').matches,
    mqDpr: matchMedia('(resolution: 1.25dppx)').matches,
  };
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.glVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
    out.glRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  } catch (e) { out.glError = String(e); }
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      const info = adapter.info || adapter;
      out.gpuVendor = info.vendor;
      out.gpuDesc = info.description || info.device;
      out.gpuArch = info.architecture;
    } else { out.gpuVendor = '(no webgpu)'; }
  } catch (e) { out.gpuError = String(e); }
  const w = new Worker('/worker.js');
  w.onmessage = (e) => { out.worker = e.data; window.__result = out; };
  setTimeout(() => { window.__result = out; }, 3000);
})();
<\/script>`;

function makeConfig() {
  return JSON.stringify({
    schemaVersion: 1,
    seed: 'f1f1f1f1f1f1f1f1',
    navigator: { platform: 'Win32', hardwareConcurrency: 12, deviceMemory: 16, languages: ['en-US', 'en'] },
    screen: { width: 1536, height: 864, availWidth: 1536, availHeight: 824, colorDepth: 24, dpr: 1.25 },
    webgl: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  });
}

const WANT = {
  dm: 16, pf: 'Win32', hc: 12,
  sw: 1536, sh: 864, saw: 1536, sah: 824, cd: 24, dpr: 1.25,
  glVendor: 'Google Inc. (NVIDIA)',
  glRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
};

app.whenReady().then(async () => {
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/worker.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/worker.js' ? workerScript : mainPage);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  global.__srv = srv;

  const ses = session.fromPartition('persist:p1');
  await ses.setProxy({ mode: 'direct' });
  ses.setFingerprintConfig(makeConfig());
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(`http://127.0.0.1:${port}/`);

  let r = null;
  for (let i = 0; i < 60; i++) {
    r = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__result || null)'));
    if (r && r.worker) break;
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
    for (const k of Object.keys(WANT)) {
      check(`${k} = ${JSON.stringify(WANT[k])}`, r[k] === WANT[k], JSON.stringify(r[k]));
    }
    check('worker deviceMemory = 16', r.worker?.dm === 16, String(r.worker?.dm));
    check('worker platform = Win32', r.worker?.pf === 'Win32', String(r.worker?.pf));
    check('worker hardwareConcurrency = 12', r.worker?.hc === 12, String(r.worker?.hc));
    check('CSS device-width 1536px', r.mqWidth === true);
    check('CSS device-height 864px', r.mqHeight === true);
    check('CSS color:8', r.mqColor === true);
    check('CSS resolution 1.25dppx', r.mqDpr === true);
    check('WebGPU vendor = nvidia', r.gpuVendor === 'nvidia', String(r.gpuVendor));
    // 默认 WebGPU（无 developer features）只暴露 vendor/architecture/subgroup，
    // description 恒为空串——与真 Chrome 一致即为通过
    check('WebGPU description 形态与真 Chrome 一致（空串或卡名）',
          r.gpuDesc === '' || (typeof r.gpuDesc === 'string' && r.gpuDesc.includes('RTX 4070')),
          String(r.gpuDesc));
    if (r.glError) check('无 GL 错误', false, r.glError);
  }

  win.destroy();
  console.log(failed ? '=== FP_P1 ACCEPT: FAIL ===' : '=== FP_P1 ACCEPT: ALL PASS ===');
  app.exit(failed ? 1 : 0);
});
