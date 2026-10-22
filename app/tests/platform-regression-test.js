const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createUpdater } = require('../updater');

const appDir = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(appDir, 'renderer', 'i18n.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(appDir, 'renderer', 'app.js'), 'utf8');
const fileDirSource = rendererSource.slice(rendererSource.indexOf('  function fileDirHref('), rendererSource.indexOf('  function applyCanvasBase('));

function inspectMain(platform, preferences, workArea = { width: 1920, height: 1040 }) {
  let options;
  let menu;
  class BrowserWindow {
    constructor(value) {
      options = value;
      this.webContents = { setWindowOpenHandler() {}, on() {} };
    }
    loadFile() {}
    on() {}
    once() {}
  }
  const electron = {
    app: { getPath: () => os.tmpdir(), whenReady: () => ({ then() {} }), on() {} },
    BrowserWindow,
    Menu: { buildFromTemplate: (value) => value, setApplicationMenu: (value) => { menu = value; } },
    ipcMain: { handle() {}, on() {} },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: workArea }) },
  };
  const context = {
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === './updater') return require('../updater');
      if (name === 'fs' && preferences !== undefined) return {
        ...fs,
        readFileSync: (filePath, ...args) => path.basename(filePath) === 'window-state.json'
          ? typeof preferences === 'string' ? preferences : JSON.stringify(preferences)
          : fs.readFileSync(filePath, ...args),
      };
      return require(name);
    },
    process: { platform, env: {} },
    __dirname: appDir,
    module: { exports: {} },
  };
  vm.runInNewContext(mainSource + '\ncurrentLocale = "en-US"; buildMenu(); createWindow();', context);
  return { options, menu };
}

function translations(platform, locale) {
  const window = { clay: { platform } };
  vm.runInNewContext(i18nSource, {
    window,
    document: { documentElement: { dataset: {} }, addEventListener() {} },
    localStorage: { getItem: () => locale },
    navigator: { language: locale },
  });
  return window.ClayI18n;
}

function fileDir(platform, sourcePath) {
  return vm.runInNewContext(fileDirSource + '\nfileDirHref(sourcePath)', { isWindows: platform === 'win32', sourcePath });
}

async function run() {
  const mac = inspectMain('darwin');
  const windows = inspectMain('win32');
  assert.strictEqual(mac.options.titleBarStyle, 'hiddenInset');
  assert.strictEqual(windows.options.titleBarStyle, 'hidden');
  assert.strictEqual(windows.options.titleBarOverlay.height, 48);
  assert.strictEqual(windows.options.titleBarOverlay.color, '#151517');
  assert.strictEqual(windows.options.autoHideMenuBar, true);
  assert.strictEqual(windows.options.show, false);
  assert.strictEqual(mac.options.titleBarOverlay, undefined);
  assert.strictEqual(mac.options.autoHideMenuBar, undefined);
  assert.strictEqual(mac.options.show, undefined);
  const restored = inspectMain('win32', { width: 1280, height: 800, theme: 'light' });
  assert.strictEqual(restored.options.width, 1280);
  assert.strictEqual(restored.options.height, 800);
  assert.strictEqual(restored.options.titleBarOverlay.color, '#ffffff');
  const smallDisplay = inspectMain('win32', { width: 99999, height: 99999 }, { width: 1024, height: 640 });
  assert.strictEqual(smallDisplay.options.width, 1024);
  assert.strictEqual(smallDisplay.options.height, 640);
  assert.strictEqual(smallDisplay.options.minWidth, 1024);
  assert.strictEqual(smallDisplay.options.minHeight, 640);
  const corruptState = inspectMain('win32', '{broken JSON');
  assert.strictEqual(corruptState.options.width, 1480);
  assert.strictEqual(corruptState.options.height, 940);
  assert.strictEqual(mac.options.webPreferences.sandbox, true);
  assert.strictEqual(windows.options.webPreferences.sandbox, true);
  assert.strictEqual(JSON.stringify(mac.menu.map((item) => item.label)), JSON.stringify(['Clay', 'File', 'Edit', 'View', 'Window']));
  assert.strictEqual(JSON.stringify(windows.menu.map((item) => item.label)), JSON.stringify(['File', 'Edit', 'View', 'Help']));
  assert(mac.menu[0].submenu.some((item) => item.role === 'hide'));
  assert.strictEqual(mac.menu[0].submenu[0].role, 'about');
  assert(!windows.menu.some((item) => item.submenu.some((child) => child.role === 'hide')));
  assert(windows.menu[0].submenu.some((item) => item.role === 'quit' && item.label === 'Exit'));
  assert(windows.menu[0].submenu.some((item) => item.role === 'close'));
  assert(windows.menu[3].submenu.some((item) => item.role === 'about'));
  assert(windows.menu[3].submenu.some((item) => item.id === 'clay-check-updates'));
  assert.strictEqual(windows.menu[1].submenu.find((item) => item.role === 'redo').accelerator, 'Ctrl+Shift+Z');
  assert.strictEqual(mac.menu[2].submenu.find((item) => item.role === 'redo').accelerator, undefined);

  for (const locale of ['zh-CN', 'en-US']) {
    const original = translations('darwin', locale);
    const ported = translations('win32', locale);
    for (const [key, value] of Object.entries(original.messages[locale])) {
      if (!value.includes('⌘')) continue;
      assert.strictEqual(original.t(key), value);
      assert.strictEqual(ported.t(key), value.replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+'));
    }
    const name = '页面 ⌘ ⇧⌘Z.html';
    assert(ported.t('status.savedAs', { file: name }).includes(name));
  }

  assert.strictEqual(fileDir('darwin', '/tmp/页面 #100%/source.html'), 'file:///tmp/' + encodeURIComponent('页面 #100%') + '/');
  assert.strictEqual(fileDir('darwin', '/tmp/back\\slash/source.html'), 'file:///tmp/back%5Cslash/');
  assert.strictEqual(fileDir('win32', 'C:\\页面 #100%\\source.html'), 'file:///C:/' + encodeURIComponent('页面 #100%') + '/');
  assert.strictEqual(fileDir('win32', 'C:/folder/source.html'), 'file:///C:/folder/');
  assert.strictEqual(fileDir('win32', '\\\\server\\share\\页面 #100%\\source.html'), 'file://server/share/' + encodeURIComponent('页面 #100%') + '/');
  assert.strictEqual(fileDir('win32', ''), '');

  const updater = createUpdater({
    currentVersion: '0.1.4', platform: 'win32', arch: 'x64', cacheDir: os.tmpdir(),
    fetch: () => { throw new Error('Windows updater must not access the network'); },
    openPath: () => { throw new Error('Windows updater must not open a DMG'); },
  });
  assert.strictEqual((await updater.check()).phase, 'unsupported');
  assert.strictEqual((await updater.download()).error, 'missing-asset');
  assert.strictEqual(await updater.openInstaller(), false);
  process.stdout.write('platform-regression-test: macOS/Windows menus, shortcuts, paths and unsupported updater passed\n');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
