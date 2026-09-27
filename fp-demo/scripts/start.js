const path = require('node:path');
const { spawn } = require('node:child_process');
const { electronPath } = require('../../scripts/runtime-path');

if (require.main === module) {
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath(), [path.resolve(__dirname, '..'), ...process.argv.slice(2)], {
      stdio: 'inherit', env, windowsHide: true,
    });
    child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { electronPath };
