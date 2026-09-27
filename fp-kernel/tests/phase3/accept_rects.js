// fp_41 regression acceptance. Run with the patched Electron executable.
// Covers double-precision readback, independent renderer determinism and opt-out.
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');

const windows = [];
let failures = 0;
let checks = 0;
function check(name, condition, detail = '') {
  checks++;
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function probe() {
  document.body.style.cssText = 'margin:0;overflow:hidden';
  const rect = value => [value.x, value.y, value.width, value.height,
    value.top, value.right, value.bottom, value.left];
  const list = values => Array.from(values, rect);
  const nodes = {};
  for (const [name, style] of Object.entries({
    small: 'left:100px;top:50px;width:300px;height:150px',
    large: 'left:1000px;top:1200px;width:1300px;height:1100px',
    transformed: 'left:987.3125px;top:1100.1875px;width:350.375px;height:80.25px;transform:rotate(11deg)',
    zero: 'left:1000px;top:1200px;width:0;height:0',
    zeroWidth: 'left:1000px;top:1200px;width:0;height:150px',
    hidden: 'left:1000px;top:1200px;width:1300px;height:1100px;display:none',
  })) {
    const element = document.createElement('div');
    element.style.cssText = 'position:absolute;' + style;
    document.body.appendChild(element);
    nodes[name] = element;
  }
  const detached = document.createElement('div');
  const textElement = document.createElement('div');
  textElement.style.cssText = 'position:absolute;left:70px;top:90px;font:16px Arial';
  textElement.textContent = 'collapsed range';
  document.body.appendChild(textElement);
  const collapsed = document.createRange();
  collapsed.setStart(textElement.firstChild, 4);
  collapsed.collapse(true);
  const emptyRange = document.createRange();
  const canvas = document.createElement('canvas').getContext('2d');
  const offscreen = new OffscreenCanvas(20, 20).getContext('2d');
  canvas.font = offscreen.font = '16px Arial';
  const metric = value => [value.width, value.actualBoundingBoxLeft,
    value.actualBoundingBoxRight, value.actualBoundingBoxAscent,
    value.actualBoundingBoxDescent];
  function snapshot() {
    const geometry = {};
    for (const [name, element] of Object.entries(nodes)) {
      const range = document.createRange();
      range.selectNode(element);
      geometry[name] = {
        bounding: rect(element.getBoundingClientRect()),
        client: list(element.getClientRects()),
        rangeBounding: rect(range.getBoundingClientRect()),
        rangeClient: list(range.getClientRects()),
      };
    }
    return {
      geometry,
      detached: { bounding: rect(detached.getBoundingClientRect()), client: list(detached.getClientRects()) },
      emptyRange: { bounding: rect(emptyRange.getBoundingClientRect()), client: list(emptyRange.getClientRects()) },
      collapsed: { bounding: rect(collapsed.getBoundingClientRect()), client: list(collapsed.getClientRects()) },
      text: metric(canvas.measureText('fingerprint-test')),
      emptyText: metric(canvas.measureText('')),
      offscreenText: metric(offscreen.measureText('fingerprint-test')),
      offscreenEmptyText: metric(offscreen.measureText('')),
      constructed: rect(new DOMRect(1000, 1200, 1300, 1100)),
      fromRect: rect(DOMRect.fromRect({ x: 1000, y: 1200, width: 1300, height: 1100 })),
      layout: [nodes.large.offsetLeft, nodes.large.offsetTop, nodes.large.offsetWidth, nodes.large.offsetHeight],
    };
  }
  return { first: snapshot(), second: snapshot() };
}

function config(seed, options = {}) {
  return JSON.stringify({ schemaVersion: 1, seed, noise: { rects: true }, ...options });
}

async function collect(name, url, configuration) {
  const ses = session.fromPartition(`rects-${process.pid}-${name}`);
  await ses.setProxy({ mode: 'direct' });
  if (configuration) ses.setFingerprintConfig(configuration);
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  windows.push(win);
  await win.loadURL(url);
  const data = await win.webContents.executeJavaScript(`(${probe.toString()})()`);
  return { pid: win.webContents.getOSProcessId(), ...data };
}

app.whenReady().then(async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html><body></body></html>');
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const results = {};
    for (const [name, configuration] of [
      ['plain', null],
      ['a', config('aaaaaaaaaaaaaaaa')],
      ['aAgain', config('aaaaaaaaaaaaaaaa')],
      ['b', config('bbbbbbbbbbbbbbbb')],
      ['disabled', config('aaaaaaaaaaaaaaaa', { disable: ['rects'] })],
      ['off', config('aaaaaaaaaaaaaaaa', { noise: { rects: false } })],
      ['unspecified', config('aaaaaaaaaaaaaaaa', { noise: {} })],
    ]) results[name] = await collect(name, url, configuration);

    for (const [name, result] of Object.entries(results)) {
      check(`${name}: repeated reads stable`, same(result.first, result.second));
    }
    const plain = results.plain.first;
    const a = results.a.first;
    const b = results.b.first;
    console.log('EVIDENCE transformed readbacks', JSON.stringify({
      plain: plain.geometry.transformed,
      a: a.geometry.transformed,
    }));
    check('same seed uses independent renderers', results.a.pid > 0 && results.aAgain.pid > 0 && results.a.pid !== results.aAgain.pid);
    check('same seed is stable across renderers', same(a, results.aAgain.first));
    for (const name of ['disabled', 'off', 'unspecified']) {
      check(`${name}: all readbacks equal unconfigured baseline`, same(results[name].first, plain));
    }
    check('unconfigured geometry retains exact large coordinates', same(plain.geometry.large.bounding.slice(0, 4), [1000, 1200, 1300, 1100]));
    check('unconfigured small coordinates retain native values', same(plain.geometry.small.bounding.slice(0, 4), [100, 50, 300, 150]));

    for (const name of ['small', 'large', 'transformed']) {
      for (const api of ['bounding', 'client', 'rangeBounding', 'rangeClient']) {
        const aa = a.geometry[name][api];
        const bb = b.geometry[name][api];
        const pp = plain.geometry[name][api];
        const isList = api === 'client' || api === 'rangeClient';
        const rows = isList ? aa : [aa];
        const otherRows = isList ? bb : [bb];
        const nativeRows = isList ? pp : [pp];
        check(`${name}/${api}: every primary field differs by seed`,
          rows.length > 0 && rows.length === otherRows.length && rows.every((row, i) => row.slice(0, 4).every((value, j) => value !== otherRows[i][j])));
        check(`${name}/${api}: finite perturbation <= 1e-5`,
          rows.length === nativeRows.length && rows.every((row, i) => row.slice(0, 4).every((value, j) => Number.isFinite(value) && Math.abs(value - nativeRows[i][j]) <= 1.00001e-5)));
        check(`${name}/${api}: DOMRect edges agree with dimensions`,
          rows.every(row => row[4] === row[1] && row[5] === row[0] + row[2] && row[6] === row[1] + row[3] && row[7] === row[0]));
      }
      // Rotated geometry can already differ between Element and Range before
      // fingerprinting (their native float paths round differently). Preserve
      // equality where native values agree; otherwise retain the native gap
      // within the sum of the two independently bounded perturbations.
      const native = plain.geometry[name];
      const nativePairs = [[native.bounding, native.rangeBounding],
        ...native.client.map((row, i) => [row, native.rangeClient[i]])];
      check(`${name}: element/range consistency respects native geometry`,
        native.client.length === native.rangeClient.length && [a, b].every(result => {
          const geometry = result.geometry[name];
          const pairs = [[geometry.bounding, geometry.rangeBounding],
            ...geometry.client.map((row, i) => [row, geometry.rangeClient[i]])];
          return geometry.client.length === geometry.rangeClient.length && pairs.length === nativePairs.length &&
            pairs.every(([left, right], i) => left.slice(0, 4).every((value, j) => {
              const [nativeLeft, nativeRight] = nativePairs[i];
              return nativeLeft[j] === nativeRight[j]
                ? value === right[j]
                : Math.abs((value - right[j]) - (nativeLeft[j] - nativeRight[j])) <= 2.00001e-5;
            }));
        }));
      check(`${name}: each single-box bounding rect equals its client rect`,
        [plain, a, b].every(result => {
          const geometry = result.geometry[name];
          return geometry.client.length === 1 && geometry.rangeClient.length === 1 &&
            same(geometry.bounding, geometry.client[0]) && same(geometry.rangeBounding, geometry.rangeClient[0]);
        }));
    }
    for (const name of ['zero', 'zeroWidth', 'hidden']) {
      check(`${name}: geometry stays identical to native baseline`, same(a.geometry[name], plain.geometry[name]) && same(b.geometry[name], plain.geometry[name]));
    }
    for (const name of ['detached', 'emptyRange', 'collapsed', 'emptyText', 'offscreenEmptyText', 'constructed', 'fromRect', 'layout']) {
      check(`${name}: stays identical to native baseline`, same(a[name], plain[name]) && same(b[name], plain[name]));
    }
    check('empty canvas and offscreen widths stay exactly zero', a.emptyText[0] === 0 && a.offscreenEmptyText[0] === 0);
    check('canvas text width differs across accounts', a.text[0] !== b.text[0]);
    check('offscreen text width differs across accounts', a.offscreenText[0] !== b.offscreenText[0]);
    check('canvas and offscreen metrics remain consistent', same(a.text, a.offscreenText));
    check('text perturbation <= 1e-5', a.text.every((value, i) => Number.isFinite(value) && Math.abs(value - plain.text[i]) <= 1.00001e-5));
  } catch (error) {
    check('test execution', false, error.stack || String(error));
  } finally {
    windows.forEach(win => { if (!win.isDestroyed()) win.destroy(); });
    server.close();
    console.log(`=== FP_RECTS ACCEPT: ${failures ? 'FAIL' : 'ALL PASS'} (${checks - failures}/${checks}) ===`);
    app.exit(failures ? 1 : 0);
  }
});
