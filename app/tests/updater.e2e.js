const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, Menu, net, shell, dialog } = require('electron');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-updater-e2e-'));
process.env.CLAY_USERDATA = path.join(testDir, 'user-data');
const body = Buffer.from('test-only installer; shell opening is stubbed');
const digest = crypto.createHash('sha256').update(body).digest('hex');
const name = `Clay-0.2.0-${process.arch}.dmg`;
let version = '0.1.1';
let networkError = false;
let fetches = 0;
const dialogs = [];
const answers = [];
const opened = [];
const external = [];
app.getVersion = () => '0.1.1';
net.fetch = async (url) => {
  fetches++;
  if (networkError) throw new Error('offline');
  if (url.endsWith('/latest')) return new Response(JSON.stringify({
    tag_name: `v${version}`, draft: false, prerelease: false,
    assets: [{ name, size: body.length }, { name: 'SHA256SUMS.txt' }],
  }));
  if (url.endsWith('SHA256SUMS.txt')) return new Response(`${digest}  ${name}\n`);
  return new Response(body);
};
shell.openPath = async (file) => { opened.push(file); return ''; };
shell.openExternal = async (url) => { external.push(url); };
dialog.showMessageBox = async (_window, options) => {
  dialogs.push(options);
  assert(answers.length, `Unexpected dialog: ${options.message}`);
  return { response: answers.shift() };
};
require('../main');

async function waitFor(fn) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Update UI did not reach the expected state');
}

app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    await waitFor(() => !win.webContents.isLoading());
    const js = (code) => win.webContents.executeJavaScript(code);
    await js('Promise.resolve(window.__clayReady).then(() => true)');
    await waitFor(() => js('document.querySelector("#btn-update").textContent.length > 0'));
    assert.strictEqual(fetches, 0, 'development/test boot must not access release service');
    assert.strictEqual((await js('window.clay.getUpdateState()')).currentVersion, '0.1.1');
    const menu = Menu.getApplicationMenu();
    assert.strictEqual(menu.items[0].label, 'Clay');
    assert(menu.items[0].submenu.items.some((item) => item.id === 'clay-check-updates'));
    assert.strictEqual(menu.items.some((item) => item.role === 'help'), false);
    assert.strictEqual(await js('document.querySelector("#btn-update").hidden'), true);
    assert.strictEqual(await js('document.querySelector("#btn-update").getBoundingClientRect().width'), 0);
    assert.strictEqual(Menu.getApplicationMenu().getMenuItemById('clay-update-menu'), null);

    networkError = true;
    answers.push(1);
    Menu.getApplicationMenu().getMenuItemById('clay-check-updates').click();
    await waitFor(() => dialogs.length === 1);
    await waitFor(() => js('window.clay.getUpdateState().then(s => s.phase === "error")'));
    assert.strictEqual(await js('document.querySelector("#btn-update").hidden'), true, 'failed checks must not advertise an update');
    networkError = false;

    // The real preload bridge reaches main-process checks and localized dialogs.
    answers.push(0);
    assert.strictEqual((await js('window.clay.checkForUpdates()')).phase, 'current');
    assert.match(dialogs.at(-1).message, /最新|up to date/);
    assert.strictEqual(await js('document.querySelector("#btn-update").hidden'), true, 'current version must not show a toolbar update');
    assert.strictEqual(await js('document.querySelector("#btn-update").getBoundingClientRect().width'), 0);
    assert.strictEqual(Menu.getApplicationMenu().getMenuItemById('clay-update-menu'), null);
    version = '0.2.0';
    answers.push(1);
    assert.strictEqual((await js('window.clay.checkForUpdates()')).phase, 'available');
    assert.strictEqual(opened.length, 0, 'Later must not download or open anything');
    assert.match(await js('document.querySelector("#btn-update").textContent'), /0\.2\.0/);
    assert.strictEqual(await js('document.querySelector("#btn-update").hidden'), false);
    assert(Menu.getApplicationMenu().getMenuItemById('clay-update-menu'));

    for (const locale of ['en-US', 'zh-CN']) {
      const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      await js(`window.ClayI18n.setLocale(${JSON.stringify(locale)}); true`);
      await loaded;
      await js('Promise.resolve(window.__clayReady).then(() => true)');
      await waitFor(() => js('document.querySelector("#btn-update").textContent.includes("0.2.0")'));
      assert.match(await js('document.querySelector("#btn-update").textContent'), locale === 'en-US' ? /Update/ : /新版/);
      for (const light of [false, true]) {
        win.setSize(1100, 700);
        await js(`if (document.body.classList.contains('light') !== ${light}) document.querySelector('#btn-theme').click(); true`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const layout = await js(`(() => {
          const bar = document.querySelector('#topbar');
          const button = document.querySelector('#btn-update');
          const r = button.getBoundingClientRect();
          return { fits: bar.scrollWidth <= bar.clientWidth, visible: r.width > 50 && r.right <= innerWidth, label: button.textContent };
        })()`);
        assert(layout.fits && layout.visible, JSON.stringify(layout));
        const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1100, height: 100 });
        fs.writeFileSync(path.join(testDir, `${locale}-${light ? 'light' : 'dark'}.png`), image.toPNG());
      }
    }

    // A real toolbar click downloads the architecture-specific fixture and opens only its verified path.
    answers.push(0, 0);
    await js('document.querySelector("#btn-update").click(); true');
    await waitFor(() => opened.length === 1 && dialogs.at(-1).message.includes('安装包已打开'));
    await waitFor(() => js('!document.querySelector("#btn-update").disabled'));
    assert.deepStrictEqual(fs.readFileSync(opened[0]), body);
    assert(opened[0].endsWith(name));
    assert(dialogs.some((item) => item.detail && item.detail.includes('退出 Clay')));
    assert.strictEqual((await js('window.clay.getUpdateState()')).phase, 'ready');
    assert.deepStrictEqual(external, []);

    // Network failure is surfaced with an actionable release-page fallback.
    fs.writeFileSync(opened[0], 'corrupt cached package');
    answers.push(0, 1);
    assert.strictEqual((await js('window.clay.checkForUpdates()')).error, 'checksum');
    assert.strictEqual(opened.length, 1);
    networkError = true;
    answers.push(2);
    assert.strictEqual((await js('window.clay.checkForUpdates()')).error, 'network');
    assert.deepStrictEqual(external, ['https://github.com/EasonYan7/clay/releases/latest']);
    assert.strictEqual(answers.length, 0);
    console.log(`Updater Electron integration passed. Screenshots and fixtures: ${testDir}`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    console.error(`Retained update fixtures: ${testDir}`);
    app.exit(1);
  }
});
