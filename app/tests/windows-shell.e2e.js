const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme } = require('electron');

if (process.platform !== 'win32') {
  console.log('windows-shell.e2e: skipped (Windows runtime required)');
  app.quit();
} else {
  // Main canonicalizes file paths, so expand 8.3 short temp paths (e.g. RUNNER~1) up front.
  const testDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-windows-shell-')));
  process.env.CLAY_USERDATA = path.join(testDir, 'profile');
  delete process.env.CLAY_PDF_OUT;
  const pdfPath = path.join(testDir, '页面 PDF.pdf');
  const reportPath = process.env.CLAY_SHELL_REPORT || path.join(testDir, 'report.json');
  const report = { platform: process.platform, testDir, checks: [] };
  const titleBars = [];
  const originalAbout = app.setAboutPanelOptions.bind(app);
  const originalAppId = app.setAppUserModelId.bind(app);
  let aboutOptions;
  let appId;
  let releasePdf;
  let pdfDialogs = 0;
  app.setAboutPanelOptions = (options) => { aboutOptions = options; originalAbout(options); };
  app.setAppUserModelId = (value) => { appId = value; originalAppId(value); };
  app.on('browser-window-created', (_event, window) => {
    for (const name of ['enter-full-screen', 'leave-full-screen']) {
      window.on(name, () => { (report.fullscreenEvents || (report.fullscreenEvents = [])).push({ name, fullscreen: window.isFullScreen() }); });
    }
    const setOverlay = window.setTitleBarOverlay.bind(window);
    window.setTitleBarOverlay = (options) => { titleBars.push(options); setOverlay(options); };
  });
  dialog.showMessageBox = async () => ({ response: 1 });
  dialog.showSaveDialog = async (_window, options) => {
    if (options.filters.some((filter) => filter.extensions.includes('pdf'))) {
      pdfDialogs++;
      return new Promise((resolve) => { releasePdf = () => resolve({ canceled: false, filePath: pdfPath }); });
    }
    return { canceled: false, filePath: path.join(testDir, '已保存.html') };
  };
  require('../main');

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let window;
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const geometry = `(() => {
    const overlay = navigator.windowControlsOverlay;
    const area = overlay.getTitlebarAreaRect();
    const toolbar = document.querySelector('#topbar').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('#topbar button')].filter((button) => button.getBoundingClientRect().width > 0);
    const fullscreen = document.documentElement.classList.contains('window-fullscreen');
    const end = !fullscreen && overlay.visible ? area.x + area.width : innerWidth;
    return { visible: overlay.visible, fullscreen, height: toolbar.height, width: innerWidth, end,
      fits: buttons.every((button) => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= end; }),
      inset: parseFloat(getComputedStyle(document.querySelector('#topbar')).paddingRight) };
  })()`;

  async function check(name, operation) {
    const started = performance.now();
    const entry = { name };
    report.checks.push(entry);
    try {
      entry.detail = await operation();
      entry.status = 'pass';
    } catch (error) {
      entry.status = 'fail';
      entry.error = error.stack;
      throw error;
    } finally {
      entry.elapsedMs = Math.round((performance.now() - started) * 10) / 10;
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }
  }

  async function run() {
    await app.whenReady();
    window = BrowserWindow.getAllWindows()[0];
    assert(window);
    if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once('did-stop-loading', resolve));
    await evaluate('window.__clayReady.then(() => true)');
    if (await evaluate('window.ClayI18n.getLocale()') !== 'zh-CN') {
      const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
      await evaluate('window.ClayI18n.setLocale("zh-CN"); true');
      await loaded;
      await evaluate('window.__clayReady.then(() => true)');
    }
    await wait(200);

    await check('native controls, hidden menu and safe area', async () => {
      assert.strictEqual(window.autoHideMenuBar, true);
      assert.strictEqual(window.isMenuBarVisible(), false);
      assert(window.isMinimizable() && window.isMaximizable() && window.isResizable());
      const bounds = await evaluate(geometry);
      assert.strictEqual(bounds.visible, true);
      assert.strictEqual(bounds.height, 48);
      assert.strictEqual(bounds.fits, true, JSON.stringify(bounds));
      assert(bounds.inset >= 100);
      assert.deepStrictEqual(Menu.getApplicationMenu().items.map((item) => item.label), ['文件', '编辑', '视图', '帮助']);
      assert(!Menu.getApplicationMenu().getMenuItemById('clay-check-updates'));
      assert.strictEqual(await evaluate('document.querySelector("#btn-update").hidden'), true);
      assert.strictEqual(aboutOptions.applicationName, 'Clay');
      assert.strictEqual(aboutOptions.applicationVersion, app.getVersion());
      assert.strictEqual(appId, 'com.clay.editor');
      assert(fs.existsSync(aboutOptions.iconPath));
      return { ...bounds, about: aboutOptions, appId };
    });

    await check('home does not parse GrapesJS or enable document actions', async () => {
      const state = await evaluate(`({ engine: typeof window.grapesjs,
        scripts: document.querySelectorAll('script[src$="grapes.min.js"]').length,
        disabled: document.querySelector('#btn-save').disabled && document.querySelector('#btn-export-pdf').disabled })`);
      assert.deepStrictEqual(state, { engine: 'undefined', scripts: 0, disabled: true });
      return state;
    });

    await check('theme IPC rejects child frames and invalid values', async () => {
      const count = titleBars.length;
      const themeListener = ipcMain.listeners('clay:window-theme')[0];
      themeListener({ sender: window.webContents, senderFrame: { url: window.webContents.getURL() } }, 'light');
      await evaluate('window.clay.setWindowTheme("sepia"); true');
      await wait(80);
      assert.strictEqual(titleBars.length, count);
      assert.strictEqual(await evaluate('window.clay.showAppMenu({ x: "bad", y: 0 })'), false);
      return { rejectedChildFrame: true, rejectedInvalidTheme: true, rejectedInvalidMenu: true };
    });

    await check('home navigation cancels a pending first import', async () => {
      await evaluate(`(() => {
        const original = window.ClayEditorRuntime.load;
        window.ClayEditorRuntime.load = () => new Promise((resolve, reject) => {
          window.__releaseEditor = () => original().then(resolve, reject);
        });
        window.__originalLoader = original;
        window.__pendingImport = window.__clay.runImport('<html><body>Cancelled import</body></html>', 'Cancelled', '');
      })()`);
      for (let attempt = 0; attempt < 50 && !await evaluate('!!window.__releaseEditor'); attempt++) await wait(20);
      assert.strictEqual(await evaluate('!!window.__releaseEditor'), true);
      await evaluate('window.__clay.goHome()');
      await evaluate('window.__releaseEditor(); true');
      assert.strictEqual(await evaluate('window.__pendingImport'), false);
      assert.strictEqual(await evaluate('window.__clay.getActiveDocId()'), null);
      assert.strictEqual(await evaluate('window.__clay.getDocs().length'), 0);
      await evaluate('window.ClayEditorRuntime.load = window.__originalLoader; true');
      return { cancelledWithoutCreatingDocument: true };
    });

    const html = '<!doctype html><html><head><style>body{background:#fff;color:#182333;padding:32px}@media(prefers-color-scheme:dark){body{background:#182333;color:#fff}}</style></head><body><h1 id="title">Windows shell</h1><p>Native controls · local canvas</p></body></html>';
    await check('import, document status and a single runtime load', async () => {
      assert.strictEqual(await evaluate(`window.__clay.runImport(${JSON.stringify(html)}, '窗口测试', '')`), true);
      await wait(500);
      assert.match(await evaluate('document.title'), /窗口测试.*Clay/);
      assert.strictEqual(await evaluate('document.querySelector("#btn-save").disabled'), false);
      const count = await evaluate('document.querySelectorAll(\'script[src$="grapes.min.js"]\').length');
      assert.strictEqual(count, 1);
      return { title: await evaluate('document.title'), runtimeLoads: count };
    });

    await check('shell theme does not change imported CSS media queries', async () => {
      const initialTheme = nativeTheme.themeSource;
      const canvasStyle = `(() => { const doc = window.__clayEditor.Canvas.getDocument(); return { dark: doc.defaultView.matchMedia('(prefers-color-scheme: dark)').matches, color: doc.defaultView.getComputedStyle(doc.body).backgroundColor }; })()`;
      const before = await evaluate(canvasStyle);
      for (let iteration = 0; iteration < 2; iteration++) {
        await evaluate('document.querySelector("#btn-theme").click(); true');
        await wait(150);
        assert.strictEqual(nativeTheme.themeSource, initialTheme);
        assert.deepStrictEqual(await evaluate(canvasStyle), before);
        const light = await evaluate('document.body.classList.contains("light")');
        assert.strictEqual(titleBars.at(-1).color, light ? '#ffffff' : '#151517');
      }
      return { systemTheme: initialTheme, importedStyle: before, overlayColors: titleBars.slice(-2) };
    });

    await check('resizing, maximize, fullscreen and restored controls', async () => {
      const states = [];
      for (const size of [[1100, 700], [1280, 820]]) {
        window.setSize(...size);
        await wait(400);
        const state = await evaluate(geometry);
        assert(state.fits, JSON.stringify(state));
        states.push(state);
      }
      window.maximize();
      await wait(450);
      assert(window.isMaximized());
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(process.env.CLAY_USERDATA, 'window-state.json'), 'utf8')).maximized, true);
      assert((await evaluate(geometry)).fits);
      window.unmaximize();
      await wait(350);
      window.setFullScreen(true);
      await wait(500);
      assert(window.isFullScreen());
      const full = await evaluate(geometry);
      report.fullscreenGeometry = full;
      assert.strictEqual(full.fullscreen, true);
      assert.strictEqual(full.inset, 10);
      assert(full.fits);
      window.setFullScreen(false);
      await wait(500);
      const restored = await evaluate(geometry);
      assert.strictEqual(restored.fullscreen, false);
      assert(restored.visible && restored.fits);
      return { sizes: states, fullscreen: full, restored };
    });

    await check('PDF exports are deduplicated with visible busy state', async () => {
      await evaluate('window.__firstPdf = window.__clay.exportPdf(); true');
      for (let attempt = 0; attempt < 100 && !releasePdf; attempt++) await wait(50);
      assert(releasePdf, 'PDF save dialog was not reached');
      assert.strictEqual(await evaluate('window.__clay.exportPdf()'), false);
      assert.strictEqual(pdfDialogs, 1);
      const busy = await evaluate('({ disabled: document.querySelector("#btn-export-pdf").disabled, busy: document.querySelector("#btn-export-pdf").getAttribute("aria-busy") })');
      assert.deepStrictEqual(busy, { disabled: true, busy: 'true' });
      releasePdf();
      assert.strictEqual(await evaluate('window.__firstPdf'), true);
      assert.strictEqual(await evaluate('document.querySelector("#btn-export-pdf").disabled'), false);
      assert.strictEqual(await evaluate('document.querySelector("#btn-export-pdf").getAttribute("aria-busy")'), 'false');
      assert.strictEqual(fs.readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
      return { dialogs: pdfDialogs, bytes: fs.statSync(pdfPath).size, restoredButton: true };
    });

    await check('save and home reset the window title', async () => {
      assert.strictEqual(await evaluate('window.__clay.saveAsCopy()'), true);
      assert.match(await evaluate('document.title'), /已保存.*Clay/);
      assert.strictEqual(await evaluate('document.querySelector("#window-status").textContent'), '已保存');
      await evaluate('window.__clay.goHome()');
      assert.strictEqual(await evaluate('document.title'), 'Clay');
      assert.strictEqual(await evaluate('document.querySelector("#btn-save").disabled'), true);
      return { title: 'Clay', homeActionsDisabled: true };
    });
    report.ok = true;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`windows-shell.e2e: ${report.checks.length} checks passed; ${reportPath}`);
  }

  const deadline = setTimeout(() => { console.error('windows-shell.e2e timed out:', reportPath); app.exit(1); }, 85000);
  run().then(() => { clearTimeout(deadline); app.exit(0); }).catch((error) => {
    clearTimeout(deadline);
    report.error = error.stack;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.error(error.stack, reportPath);
    app.exit(1);
  });
}
