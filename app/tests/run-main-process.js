const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-main-process-test-'));
let status = 1;

try {
  const result = spawnSync(require('electron'), [path.join(__dirname, 'main-process-regression-test.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, CLAY_MAIN_PROCESS_TEST_DIR: testDir },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  status = Number.isInteger(result.status) ? result.status : 1;
  if (status === 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
} catch (error) {
  console.error(error);
  status = 1;
}

if (status !== 0) console.error(`main-process regression: retained diagnostics at ${testDir}`);
process.exit(status);
