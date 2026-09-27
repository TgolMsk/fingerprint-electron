const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { electronPath } = require('../scripts/start');

// Real navigation and storage checks use a loopback origin, never a user account.
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Fingerprint tester navigation fixture</title>
<body style="font:20px system-ui;padding:32px;background:#f3f7fa;color:#15304a">
<h1>Navigation fixture</h1><p id="location"></p><p>Isolated end-to-end test.</p>
<script>window.loadToken=crypto.randomUUID();document.getElementById('location').textContent=location.pathname;</script>
</body></html>`;

async function run() {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-demo-tester-'));
  const resultRoot = path.resolve(__dirname, '..', 'test-results', `tester-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(resultRoot, { recursive: true });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(fixture);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const summary = { startedAt: new Date().toISOString(), stateRoot, resultRoot, fixtureUrl: `http://127.0.0.1:${server.address().port}` };
  let child;
  try {
    summary.executable = electronPath();
    const env = { ...process.env, FP_TESTER_STATE: stateRoot, FP_TESTER_RESULTS: resultRoot, FP_TESTER_FIXTURE: summary.fixtureUrl };
    delete env.ELECTRON_RUN_AS_NODE;
    const stdout = fs.createWriteStream(path.join(resultRoot, 'stdout.log'));
    const stderr = fs.createWriteStream(path.join(resultRoot, 'stderr.log'));
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(summary.executable, [path.join(__dirname, 'tester-main.js')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(stdout); child.stderr.pipe(stderr);
      child.stdout.on('data', (data) => process.stdout.write(data));
      const deadline = setTimeout(() => {
        summary.timedOut = true;
        // Terminate only the process tree created above, including renderer children.
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => child.kill('SIGKILL'));
        } else child.kill('SIGKILL');
      }, 180000);
      child.once('error', (error) => { clearTimeout(deadline); stdout.end(); stderr.end(); reject(error); });
      child.once('close', (code, signal) => {
        clearTimeout(deadline); summary.signal = signal; resolve(code ?? 1);
      });
    });
    summary.exitCode = exitCode;
    const reportPath = path.join(resultRoot, 'tester.json');
    if (fs.existsSync(reportPath)) summary.report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    summary.passed = exitCode === 0 && !summary.timedOut && summary.report?.passed === true;
  } catch (error) {
    summary.passed = false; summary.error = error.stack;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    summary.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(resultRoot, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`RESULT ${summary.passed ? 'PASS' : 'FAIL'} ${path.join(resultRoot, 'summary.json')}`);
    process.exitCode = summary.passed ? 0 : 1;
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
