const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, dialog, net, shell } = require('electron');

if (process.platform !== 'win32') {
  console.log('windows-port.e2e: skipped (Windows runtime required)');
  app.quit();
} else {
  // Main canonicalizes file paths, so expand 8.3 short temp paths (e.g. RUNNER~1) up front.
  const testDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-windows-port-')));
  const assetDir = path.join(testDir, '中文 空格#%');
  fs.mkdirSync(assetDir);
  const sourcePath = path.join(assetDir, '页面 #100%.html');
  const copyPath = path.join(assetDir, '另存为 副本.html');
  const pdfPath = path.join(assetDir, '导出 PDF.pdf');
  const imageName = '图片 #%.png';
  fs.writeFileSync(path.join(assetDir, imageName), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  fs.writeFileSync(sourcePath, '<!doctype html><html><head><style>body{margin:0}h1{color:#123456}</style></head><body>'
    + `<h1 id="win-title">Windows fixture</h1><img id="win-image" src="${encodeURIComponent(imageName)}" width="32" height="32">`
    + '<script>window.__winImportedScript = true;</script></body></html>');
  process.env.CLAY_USERDATA = path.join(testDir, 'user-data');
  process.env.CLAY_TEST_CLOSE = '1';
  process.env.CLAY_PDF_OUT = pdfPath;
  let saveOptions;
  const messages = [];
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] });
  dialog.showSaveDialog = async (_window, options) => {
    saveOptions = options;
    return { canceled: false, filePath: copyPath };
  };
  dialog.showMessageBox = async (_window, options) => {
    messages.push(options);
    return { response: 1 };
  };
  net.fetch = () => { throw new Error('Windows update check accessed the network'); };
  shell.openExternal = () => { throw new Error('Unexpected external browser launch'); };
  require('../main');

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const report = { platform: process.platform, testDir, checks: [] };
  const evaluate = (window, source) => window.webContents.executeJavaScript(source);

  async function ready(window) {
    if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once('did-stop-loading', resolve));
    await evaluate(window, 'window.__clayReady.then(() => true)');
  }

  async function run() {
    await app.whenReady();
    const window = BrowserWindow.getAllWindows()[0];
    assert(window);
    window.setSize(1100, 700);
    window.hide();
    await ready(window);
    assert.strictEqual(window.webContents.getLastWebPreferences().sandbox, true);
    for (const locale of ['en-US', 'zh-CN']) {
      if (await evaluate(window, 'window.ClayI18n.getLocale()') !== locale) {
        const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
        await evaluate(window, `window.ClayI18n.setLocale(${JSON.stringify(locale)})`);
        await loaded;
        await ready(window);
      }
      await wait(150);
      const notesFit = 'Array.from(document.querySelectorAll("#sketch-layer text")).every((element) => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth; })';
      for (let attempt = 0; attempt < 40 && !await evaluate(window, notesFit); attempt++) await wait(100);
      const ui = await evaluate(window, `({
        platform: window.clay.platform,
        dpr: devicePixelRatio,
        padding: getComputedStyle(document.querySelector('#topbar')).paddingLeft,
        font: getComputedStyle(document.body).fontFamily,
        shortcut: document.querySelector('.btn-kbd').textContent,
        redo: document.querySelector('#btn-redo').title,
        fits: document.querySelector('#topbar').scrollWidth <= document.querySelector('#topbar').clientWidth,
        macHints: Array.from(document.querySelectorAll('[title]')).some((element) => /[⌘⇧]/.test(element.title)),
        notesFit: ${notesFit},
      })`);
      if (!ui.notesFit) report.checks.push(await evaluate(window, `({ width: innerWidth, notes: Array.from(document.querySelectorAll('#sketch-layer text')).map((element) => ({ text: element.textContent, bounds: element.getBoundingClientRect().toJSON() })) })`));
      assert.strictEqual(ui.platform, 'win32');
      assert.strictEqual(ui.padding, '10px');
      assert.match(ui.font, /Segoe UI/);
      assert.strictEqual(ui.shortcut, 'Ctrl+O');
      assert.match(ui.redo, /Ctrl\+Shift\+Z/);
      assert.strictEqual(ui.fits, true);
      assert.strictEqual(ui.macHints, false);
      assert.strictEqual(ui.notesFit, true);
      const menu = Menu.getApplicationMenu();
      assert.strictEqual(menu.items.length, 4);
      assert(menu.items[0].submenu.items.some((item) => item.role === 'quit'));
      assert(menu.items[3].submenu.items.some((item) => item.role === 'about'));
      assert(!menu.getMenuItemById('clay-check-updates'));
      assert.strictEqual(await evaluate(window, 'document.querySelector("#btn-update").hidden'), true);
      report.checks.push({ locale, ui, menu: menu.items.map((item) => item.label) });
    }
    const update = await evaluate(window, 'window.clay.checkForUpdates()');
    assert.strictEqual(update.phase, 'unsupported');
    assert.strictEqual(messages.length, 1);
    report.checks.push('unsupported update check: no network or external launch');

    const opened = await evaluate(window, 'window.clay.openFile()');
    assert.strictEqual(opened.path, sourcePath);
    await evaluate(window, `window.__clay.runImport(${JSON.stringify(opened.content)}, 'Windows fixture', ${JSON.stringify(opened.path)})`);
    const image = await evaluate(window, `(async () => {
      const frame = window.__clayEditor.Canvas.getDocument();
      for (let attempt = 0; attempt < 80; attempt++) {
        const image = frame.querySelector('#win-image');
        if (image && image.complete && image.naturalWidth && image.getAttribute('src') === ${JSON.stringify(encodeURIComponent(imageName))}) return { base: frame.querySelector('#clay-base').href, width: image.naturalWidth, src: image.getAttribute('src'), currentSrc: image.currentSrc, script: !!frame.defaultView.__winImportedScript };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Relative image did not load from Windows source directory: ' + frame.querySelector('#win-image').outerHTML);
    })()`);
    report.checks.push({ relativeImage: image });
    assert.strictEqual(image.base, pathToFileURL(assetDir + path.sep).href);
    assert.strictEqual(image.width, 1);
    assert.strictEqual(image.script, false);

    await evaluate(window, `window.__clayEditor.getWrapper().find('#win-title')[0].components('Windows edited'); true`);
    await wait(300);
    await evaluate(window, `document.querySelector('#btn-undo').click(); true`);
    assert.match(await evaluate(window, 'window.__clayEditor.getHtml()'), /Windows fixture/);
    await evaluate(window, `document.querySelector('#btn-redo').click(); true`);
    assert.match(await evaluate(window, 'window.__clayEditor.getHtml()'), /Windows edited/);
    await evaluate(window, 'window.__clay.saveToSource()');
    assert.match(fs.readFileSync(sourcePath, 'utf8'), /Windows edited/);
    await evaluate(window, 'window.__clay.saveAsCopy()');
    assert.match(fs.readFileSync(copyPath, 'utf8'), /Windows edited/);
    assert.strictEqual(path.dirname(saveOptions.defaultPath), assetDir);
    assert(!path.basename(saveOptions.defaultPath).includes('C-'));
    const activeName = await evaluate(window, 'window.__clay.getDocs().find((item) => item.id === window.__clay.getActiveDocId()).name');
    assert.strictEqual(activeName, path.basename(copyPath, '.html'));
    report.checks.push('import -> edit -> undo/redo -> save -> save as: Chinese, spaces, #, % and backslashes');

    const pdf = await evaluate(window, `window.clay.exportPdf('test.pdf', '<html><body><h1>Windows PDF</h1></body></html>', 800, 600, '')`);
    assert.strictEqual(pdf.ok, true, JSON.stringify(pdf));
    assert.strictEqual(fs.readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
    report.checks.push({ pdf: pdfPath, bytes: fs.statSync(pdfPath).size });
    await evaluate(window, 'window.__clay.goHome()');
    await evaluate(window, `window.__clay.openRecent(${JSON.stringify(copyPath)})`);
    assert.match(await evaluate(window, 'window.__clayEditor.getHtml()'), /Windows edited/);
    report.checks.push('reopen saved copy');
  }

  let timer;
  Promise.race([run(), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Windows runtime probe timed out')), 90000); })])
    .then(() => { report.ok = true; })
    .catch((error) => { report.ok = false; report.error = error.stack; console.error(error); })
    .finally(() => {
      clearTimeout(timer);
      const destination = process.env.CLAY_WINDOWS_REPORT || path.join(testDir, 'report.json');
      fs.writeFileSync(destination, JSON.stringify(report, null, 2));
      console.log(`windows-port.e2e: ${report.ok ? 'passed' : 'failed'}; ${destination}`);
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.destroy();
      app.exit(report.ok ? 0 : 1);
    });
}
