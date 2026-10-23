const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'editor-runtime.js'), 'utf8');

function createRuntime(platform) {
  const scripts = [];
  const writes = [];
  const timers = new Map();
  const window = { clay: { platform } };
  let sequence = 0;
  vm.runInNewContext(source, {
    window,
    document: {
      write: (html) => writes.push(html),
      createElement: () => ({ remove() { this.removed = true; } }),
      head: { appendChild: (script) => scripts.push(script) },
    },
    setTimeout: (callback) => { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  return { window, scripts, writes, timers };
}

async function run() {
  const mac = createRuntime('darwin');
  assert.deepStrictEqual(mac.writes, ['<script src="vendor/grapes.min.js"></script>']);
  assert.strictEqual(mac.scripts.length, 0);
  assert.strictEqual(mac.window.ClayEditorRuntime, undefined);

  const windows = createRuntime('win32');
  const load = windows.window.ClayEditorRuntime.load;
  assert.strictEqual(windows.scripts.length, 0);
  assert.strictEqual(windows.writes.length, 0);
  const first = load();
  assert.strictEqual(first, load());
  assert.strictEqual(windows.scripts.length, 1);
  assert.strictEqual(windows.scripts[0].src, 'vendor/grapes.min.js');
  windows.window.grapesjs = { init() {} };
  windows.scripts[0].onload();
  await first;
  await load();
  assert.strictEqual(windows.scripts.length, 1);
  assert.strictEqual(windows.timers.size, 0);

  const retry = createRuntime('win32');
  const rejected = assert.rejects(retry.window.ClayEditorRuntime.load(), /Unable to load/);
  retry.scripts[0].onerror();
  await rejected;
  assert.strictEqual(retry.scripts[0].removed, true);
  assert.strictEqual(retry.timers.size, 0);
  const second = retry.window.ClayEditorRuntime.load();
  assert.strictEqual(retry.scripts.length, 2);
  retry.window.grapesjs = {};
  retry.scripts[1].onload();
  await second;

  const timeout = createRuntime('win32');
  const timedOut = assert.rejects(timeout.window.ClayEditorRuntime.load(), /timed out/);
  [...timeout.timers.values()][0]();
  await timedOut;
  assert.strictEqual(timeout.scripts[0].removed, true);
  assert.strictEqual(timeout.timers.size, 0);
  const recovery = timeout.window.ClayEditorRuntime.load();
  timeout.window.grapesjs = {};
  timeout.scripts[1].onload();
  await recovery;

  const missing = createRuntime('win32');
  const unavailable = assert.rejects(missing.window.ClayEditorRuntime.load(), /unavailable/);
  missing.scripts[0].onload();
  await unavailable;
  assert.strictEqual(missing.scripts[0].removed, true);
  process.stdout.write('editor-runtime-regression-test: lazy load, deduplication, retry, timeout and macOS eager path passed\n');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
