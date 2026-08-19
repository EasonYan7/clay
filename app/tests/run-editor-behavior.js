const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-editor-test-'));
const electronPath = require('electron');
const testPath = path.join(__dirname, 'editor-behavior.e2e.js');
let status = 1;

try {
  const result = spawnSync(electronPath, [testPath], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { CLAY_EDITOR_TEST_DIR: testDir }),
    stdio: 'inherit',
  });
  status = Number.isInteger(result.status) ? result.status : 1;
  if (result.error) throw result.error;
} catch (err) {
  process.stderr.write((err && err.stack) || String(err));
  process.stderr.write('\n');
  status = 1;
} finally {
  // Electron 主进程退出后,helper 可能还要一拍才完全放弃缓存文件。
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

process.exit(status);
