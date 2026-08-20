const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-i18n-test-'));
app.setPath('userData', path.join(testDir, 'user-data'));

async function waitForClayReady(win) {
  await win.webContents.executeJavaScript(`(async () => {
    if (!window.__clayReady) throw new Error('window.__clayReady is missing');
    await window.__clayReady;
    return true;
  })()`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
  });

  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await win.webContents.executeJavaScript(`localStorage.setItem('clay-locale', 'en-US')`);
    await win.reload();
    await waitForClayReady(win);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const home = await win.webContents.executeJavaScript(`({
      lang: document.documentElement.lang,
      title: document.querySelector('.empty-left h1').textContent,
      subtitle: document.querySelector('.empty-left > p').textContent,
      open: document.querySelector('#btn-empty-import').textContent,
      save: document.querySelector('#btn-save').textContent,
      englishActive: document.querySelector('[data-locale="en-US"]').classList.contains('active'),
      switchFits: document.querySelector('.locale-switch').scrollWidth <= document.querySelector('.locale-switch').clientWidth,
    })`);
    assert.strictEqual(home.lang, 'en');
    assert.match(home.title, /editable canvas/i);
    assert.match(home.subtitle, /export clean code/i);
    assert.match(home.open, /Open HTML file/i);
    assert.match(home.save, /Save/i);
    assert.strictEqual(home.englishActive, true);
    assert.strictEqual(home.switchFits, true);

    async function switchLocale(locale) {
      const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      await win.webContents.executeJavaScript(`window.ClayI18n.setLocale(${JSON.stringify(locale)})`);
      await loaded;
      await waitForClayReady(win);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await switchLocale('zh-CN');
    const chinese = await win.webContents.executeJavaScript(`({
      title: document.querySelector('.empty-left h1').textContent,
      chineseActive: document.querySelector('[data-locale="zh-CN"]').classList.contains('active'),
    })`);
    assert.match(chinese.title, /可编辑的画布/);
    assert.strictEqual(chinese.chineseActive, true);

    await switchLocale('en-US');
    const englishAgain = await win.webContents.executeJavaScript(`({
      title: document.querySelector('.empty-left h1').textContent,
      englishActive: document.querySelector('[data-locale="en-US"]').classList.contains('active'),
    })`);
    assert.match(englishAgain.title, /editable canvas/i);
    assert.strictEqual(englishAgain.englishActive, true);

    const editorUi = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      window.__clay.runImport(window.CLAY_SAMPLES.plaincss, 'English test', '', 'i18n-test');
      const deadline = Date.now() + 4000;
      const check = () => {
        const ed = window.__clayEditor;
        if (!ed || !ed.getWrapper().components().length) {
          if (Date.now() < deadline) return setTimeout(check, 40);
          return reject(new Error('editor did not initialize'));
        }
        const names = [];
        const collect = (component) => {
          const name = component.get('custom-name');
          if (name) names.push(name);
          component.components().forEach(collect);
        };
        collect(ed.getWrapper());
        resolve({
          sectors: ed.StyleManager.getSectors().map((sector) => sector.getName()),
          pageName: ed.getWrapper().get('custom-name'),
          componentNames: names,
        });
      };
      check();
    })`);
    assert.deepStrictEqual(editorUi.sectors, [
      'Typography', 'Background', 'Corners & Border', 'Spacing', 'Size', 'Layout (Container)', 'Effects',
    ]);
    assert.strictEqual(editorUi.pageName, 'Page');
    assert(editorUi.componentNames.some((name) => /Header|Heading|Text|Section|Container|Card/.test(name)),
      `expected localized component name, got ${JSON.stringify(editorUi.componentNames)}`);

    const closeDialog = await win.webContents.executeJavaScript(`new Promise(async (resolve) => {
      window.clay = {
        confirm: async (opts) => { window.__lastEnglishConfirm = opts; return 2; }
      };
      const doc = window.__clay.getDocs()[0];
      doc.dirty = true;
      await window.__clay.closeDoc(doc.id);
      resolve(window.__lastEnglishConfirm);
    })`);
    assert.deepStrictEqual(closeDialog.buttons, ['Save as File…', 'Don’t Save', 'Cancel']);
    assert.match(closeDialog.message, /not been saved as a file/i);

    process.stdout.write('i18n.e2e: ok\n');
  } catch (err) {
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
    process.exitCode = 1;
  } finally {
    win.destroy();
    // Wait for Electron's quit event before removing the profile.  The
    // renderer/helper process can still be flushing files after destroy().
    app.once('quit', () => {
      if (!process.exitCode) fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      else process.stderr.write(`i18n test data preserved at ${testDir}\n`);
    });
    app.quit();
  }
});
