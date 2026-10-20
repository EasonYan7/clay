const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-undo-canvas-test-'));
app.setPath('userData', path.join(testDir, 'user-data'));

// Undo/redo rewrite CSS rules without firing component:styleUpdate. The canvas
// must still repaint, otherwise it keeps showing the pre-undo style.
const fixture = `<!doctype html><html><head><style>
  .track{width:500px;height:20px;position:relative}
  .fill{position:absolute;left:0;top:0;height:20px;width:40%;background:#222}
</style></head><body><div class="track"><div class="fill"></div></div></body></html>`;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await js(`(async () => { await window.__clayReady; return true; })()`);
    await js(`(async () => {
      await window.__clay.runImport(${JSON.stringify(fixture)}, 'undo-canvas', '', 'undo-canvas-test');
      await new Promise((r) => setTimeout(r, 1500));
      return true;
    })()`);

    const width = () => js(`(() => {
      const fill = window.__clayEditor.Canvas.getDocument().querySelector('.fill');
      return Math.round(fill.getBoundingClientRect().width / 5);
    })()`);

    assert.strictEqual(await width(), 40);
    await js(`(() => {
      const ed = window.__clayEditor;
      ed.select(ed.getWrapper().find('.fill')[0]);
      return true;
    })()`);
    await wait(300);
    // Type into the Style panel, the way a user resizes an element.
    const typed = await js(`(() => {
      const input = document.querySelector('#style-mount .gjs-sm-property__width input');
      if (!input) return false;
      input.value = '80%';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.strictEqual(typed, true, 'Style panel width input not found');
    await wait(400);
    assert.strictEqual(await width(), 80);

    await js(`document.querySelector('#btn-undo').click()`);
    await wait(400);
    assert.strictEqual(await width(), 40, 'canvas did not repaint after undo');

    await js(`document.querySelector('#btn-redo').click()`);
    await wait(400);
    assert.strictEqual(await width(), 80, 'canvas did not repaint after redo');

    process.stdout.write('undo-canvas.e2e: ok\n');
  } catch (err) {
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
    process.exitCode = 1;
  } finally {
    try { win.destroy(); } catch (e) { /* already closed */ }
    app.once('quit', () => {
      if (!process.exitCode) fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      else process.stderr.write(`undo-canvas test data preserved at ${testDir}\n`);
    });
    app.quit();
  }
});
