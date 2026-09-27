const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
// SpeakerSelection is not enabled by default in this Electron build.
// Enable it explicitly to exercise its Permissions-Policy gate too.
app.commandLine.appendSwitch('enable-blink-features', 'SpeakerSelection');
const windows = [];
let failures = 0;
const check = (name, condition, detail = '') => { if (!condition) failures++; console.log(`${condition ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url !== '/authorized') res.setHeader('Permissions-Policy', 'camera=(), microphone=(), speaker-selection=()');
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><body>Media policy/authorization acceptance');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const results = {};
  try {
    for (const mode of ['plain', 'configured', 'disabled', 'plain-authorized', 'configured-authorized']) {
      const ses = session.fromPartition(mode);
      await ses.setProxy({ mode: 'direct' });
      const authorized = mode.endsWith('-authorized');
      ses.setPermissionCheckHandler(() => authorized);
      ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(authorized));
      if (!mode.startsWith('plain')) ses.setFingerprintConfig(JSON.stringify({ schemaVersion: 1, seed: 'media-policy-test', disable: mode === 'disabled' ? ['media'] : [] }));
      const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } }); windows.push(win);
      await win.loadURL('http://127.0.0.1:' + server.address().port + (authorized ? '/authorized' : '/'));
      const data = await win.webContents.executeJavaScript(`(async () => ({ devices: (await navigator.mediaDevices.enumerateDevices()).map(d => d.kind), labels: (await navigator.mediaDevices.enumerateDevices()).map(d => d.label), voices: speechSynthesis.getVoices().map(v => ({name:v.name, uri:v.voiceURI})) }))()`);
      results[mode] = data;
      console.log('INFO native/template device kinds', mode, JSON.stringify(data.devices));
      if (mode === 'configured') {
        check('configured: policy excludes all template device types', data.devices.length === 0, JSON.stringify(data.devices));
        check('configured: voiceURI uses Chromium name format', data.voices.length === 3 && data.voices.every(v => v.uri === v.name));
      }
    }
    check('disabled: preserves native enumeration behavior', JSON.stringify(results.disabled.devices) === JSON.stringify(results.plain.devices));
    check('authorized baseline exposes real labels', results['plain-authorized'].labels.some(Boolean));
    check('authorized config preserves native device kinds and labels', JSON.stringify(results['plain-authorized'].devices) === JSON.stringify(results['configured-authorized'].devices) && JSON.stringify(results['plain-authorized'].labels) === JSON.stringify(results['configured-authorized'].labels));
  } catch (err) { check('no exception', false, err.stack); }
  windows.forEach(w => w.destroy()); server.close();
  console.log(failures ? '=== MEDIA ACCEPT: FAIL ===' : '=== MEDIA ACCEPT: ALL PASS ===');
  app.exit(failures ? 1 : 0);
});
