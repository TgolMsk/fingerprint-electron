// Exercise real installed fonts, CSS fallback, localized names and local().
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const windows = [];
let failures = 0;
const check = (name, condition, detail = '') => { if (!condition) failures++; console.log(`${condition ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const probe = async () => {
  const fonts = ['Arial', 'Calibri', 'Consolas', 'Cascadia Code', 'Courier New', 'Times New Roman', '宋体', 'DefinitelyNotInstalledXYZ'];
  const samples = ['mmmmiiiiwwww', 'The quick brown fox 1234567890', 'iiiiWWWW0000'];
  const result = {};
  for (const family of fonts) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '16px "' + family + '", "Courier New"';
    result[family] = { widths: samples.map(text => ctx.measureText(text).width) };
    ctx.font = '16px "' + family + '", monospace';
    result[family].generic = samples.map(text => ctx.measureText(text).width);
  }
  for (const family of [...fonts, 'ArialMT', 'Arial Bold']) {
    try { await new FontFace('probe', 'local("' + family + '")').load(); (result[family] ||= {}).local = true; }
    catch { (result[family] ||= {}).local = false; }
  }
  return result;
};
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body>Font acceptance'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = {};
  try {
    for (const mode of ['plain', 'filtered', 'disabled', 'unknown-template']) {
      const ses = session.fromPartition(mode);
      await ses.setProxy({ mode: 'direct' });
      if (mode !== 'plain') ses.setFingerprintConfig(JSON.stringify({schemaVersion: 1, seed: 'fonts-acceptance', fonts: mode === 'unknown-template' ? 'not-supported' : 'win-default', noise: { rects: false }, disable: mode === 'disabled' ? ['fonts'] : []}));
      const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } }); windows.push(win);
      await win.loadURL('http://127.0.0.1:' + server.address().port);
      result[mode] = await win.webContents.executeJavaScript('(' + probe.toString() + ')()');
    }
    const p = result.plain, f = result.filtered;
    for (const font of ['Arial', 'Calibri', 'Consolas', 'Courier New', 'Times New Roman']) {
      check(font + ': real font present in baseline', p[font].local);
      check(font + ': whitelist preserves native metrics/local()', JSON.stringify(p[font]) === JSON.stringify(f[font]));
    }
    check('localized family alias preserves native behavior', JSON.stringify(p['宋体']) === JSON.stringify(f['宋体']));
    check('PostScript/full names of allowed families work', f.ArialMT.local && f['Arial Bold'].local);
    check('excluded test font actually installed in baseline', p['Cascadia Code'].local);
    check('excluded family blocked through local()', !f['Cascadia Code'].local);
    check('excluded family uses the same explicit fallback as nonexistent font', JSON.stringify(f['Cascadia Code'].widths) === JSON.stringify(f.DefinitelyNotInstalledXYZ.widths));
    check('allowed Arial retains metrics distinct from fallback', JSON.stringify(f.Arial.widths) !== JSON.stringify(f.DefinitelyNotInstalledXYZ.widths));
    check('CSS generic fallback preserves native metrics', JSON.stringify(p.DefinitelyNotInstalledXYZ.generic) === JSON.stringify(f.DefinitelyNotInstalledXYZ.generic));
    check('disable fonts restores all native behavior', JSON.stringify(result.disabled) === JSON.stringify(p));
    check('unknown template leaves native behavior unchanged', JSON.stringify(result['unknown-template']) === JSON.stringify(p));
  } catch (error) { check('no exception', false, error.stack); }
  for (const win of windows) win.destroy(); server.close();
  console.log(failures ? '=== FONTS ACCEPT: FAIL ===' : '=== FONTS ACCEPT: ALL PASS ===');
  app.exit(failures ? 1 : 0);
});
