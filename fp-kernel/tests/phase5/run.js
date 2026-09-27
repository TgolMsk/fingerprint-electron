// Node launcher keeps a waitable process alive for Windows GUI Electron.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(process.env.FP_PHASE5_OUTPUT || path.join(__dirname, '../../reports/phase5', runId));
fs.mkdirSync(output, { recursive: true });
const executable = process.env.FP_ELECTRON || require('../../../scripts/runtime-path').electronPath();
const child = spawn(executable, [path.join(__dirname, 'run-external.js')], {
  env: { ...process.env, FP_PHASE5_OUTPUT: output }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stdout = fs.createWriteStream(path.join(output, 'stdout.log'));
const stderr = fs.createWriteStream(path.join(output, 'stderr.log'));
child.stdout.pipe(stdout); child.stdout.pipe(process.stdout);
child.stderr.pipe(stderr); child.stderr.pipe(process.stderr);
child.once('error', error => { console.error(error); process.exitCode = 2; });
child.once('exit', (code, signal) => {
  fs.writeFileSync(path.join(output, 'process.json'), JSON.stringify({ code, signal, executable, output }, null, 2));
  process.exitCode = code === null ? 2 : code;
});
