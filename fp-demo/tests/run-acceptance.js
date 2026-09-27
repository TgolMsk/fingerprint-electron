const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { electronPath } = require('../scripts/start');

async function run() {
  const executable = electronPath();
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-demo-acceptance-'));
  const resultRoot = path.resolve(__dirname, '..', 'test-results', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(resultRoot, { recursive: true });
  const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'));
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/worker.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end('postMessage({ua:navigator.userAgent,platform:navigator.platform,cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory,languages:[...navigator.languages]})');
    } else if (request.url === '/headers') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ua: request.headers['user-agent'], language: request.headers['accept-language'] }));
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const summary = { startedAt: new Date().toISOString(), executable, stateRoot, resultRoot, url, phases: [] };
  try {
    for (const phase of ['bootstrap', 'restart']) {
      const env = { ...process.env, FP_DEMO_TEST_STATE: stateRoot, FP_DEMO_TEST_RESULTS: resultRoot, FP_DEMO_TEST_URL: url, FP_DEMO_TEST_PHASE: phase };
      delete env.ELECTRON_RUN_AS_NODE;
      const stdout = fs.createWriteStream(path.join(resultRoot, `${phase}.stdout.log`));
      const stderr = fs.createWriteStream(path.join(resultRoot, `${phase}.stderr.log`));
      const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(executable, [path.join(__dirname, 'acceptance-main.js')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(stdout); child.stderr.pipe(stderr);
        child.stdout.on('data', (data) => process.stdout.write(data));
        child.on('error', reject); child.on('exit', (code) => resolve(code ?? 1));
      });
      summary.phases.push({ phase, exitCode, ...JSON.parse(fs.readFileSync(path.join(resultRoot, `${phase}.json`), 'utf8')) });
      if (exitCode !== 0) break;
      if (phase === 'bootstrap') {
        // 在临时账号文件中复现旧版 UA 格式，以真实重启验证无损迁移。
        const accountFile = path.join(stateRoot, 'userData', 'accounts.json');
        const accounts = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
        const fp = accounts[0].fp;
        fp.uaString = fp.uaString.replace(`Chrome/${fp.ua.fullVersion} `, `Chrome/${fp.ua.fullVersion}.0.0.0 `);
        fs.writeFileSync(accountFile, JSON.stringify(accounts, null, 2));
        summary.legacyUaMigrationFixture = true;
      }
    }
    summary.passed = summary.phases.length === 2 && summary.phases.every((phase) => phase.exitCode === 0 && phase.passed);
  } catch (error) {
    summary.passed = false; summary.error = error.stack;
  } finally {
    server.close();
    summary.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(resultRoot, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`RESULT ${summary.passed ? 'PASS' : 'FAIL'} ${path.join(resultRoot, 'summary.json')}`);
    process.exitCode = summary.passed ? 0 : 1;
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
