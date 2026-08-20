const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-main-process-test-'));
const userData = path.join(testDir, 'user-data');
const safePdf = path.join(testDir, 'safe.pdf');
const remotePdf = path.join(testDir, 'remote.pdf');
const atomicFailurePdf = path.join(testDir, 'atomic-failure.pdf');
const tallPdf = path.join(testDir, 'tall.pdf');
const widePdf = path.join(testDir, 'wide.pdf');
const surfacePdf = path.join(testDir, 'surface.pdf');
const allowedHtml = path.join(testDir, 'allowed.html');
const replacementHtml = path.join(testDir, 'replacement.html');
const symlinkHtml = path.join(testDir, 'symlink.html');
const watchA = path.join(testDir, 'watch-a.html');
const watchB = path.join(testDir, 'watch-b.html');
const missingWatch = path.join(testDir, 'watch-missing.html');
fs.writeFileSync(allowedHtml, '<!doctype html><body>allowed</body>', 'utf8');
fs.writeFileSync(replacementHtml, '<!doctype html><body>replacement</body>', 'utf8');
fs.writeFileSync(watchA, '<!doctype html><body>watch-a</body>', 'utf8');
fs.writeFileSync(watchB, '<!doctype html><body>watch-b</body>', 'utf8');
process.env.CLAY_USERDATA = userData;
process.env.CLAY_PDF_OUT = safePdf;
process.env.CLAY_TEST_CLOSE = '1';

const main = require('../main');
let fixtureServer = null;
let fixtureBase = '';
const fixtureRequests = [];

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    fixtureServer = http.createServer((request, response) => {
      fixtureRequests.push(request.url);
      if (request.url === '/pixel.png') {
        response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
        return;
      }
      if (request.url === '/blocked.js') {
        response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
        response.end('window.__remoteScriptExecuted = true;');
        return;
      }
      response.writeHead(404);
      response.end('not found');
    });
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', () => {
      fixtureBase = `http://127.0.0.1:${fixtureServer.address().port}`;
      resolve();
    });
  });
}

function waitForLoad(window) {
  if (!window.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
}

async function invokePdf(window, output, html) {
  process.env.CLAY_PDF_OUT = output;
  return window.webContents.executeJavaScript(
    `window.clay.exportPdf('regression.pdf', ${JSON.stringify(html)}, 800, 600, '')`,
  );
}

let succeeded = false;

app.whenReady().then(async () => {
  let failure = null;
  try {
    await startFixtureServer();
    const window = BrowserWindow.getAllWindows()[0];
    assert(window, 'main window was not created');
    await waitForLoad(window);
    await window.webContents.executeJavaScript(
      'window.__clayReady ? Promise.resolve(window.__clayReady).then(() => true) : true',
    );

    const rendererUrl = window.webContents.getURL();
    assert.match(rendererUrl, /\/renderer\/index\.html$/);
    await window.webContents.executeJavaScript(`location.assign('data:text/html,<h1>blocked</h1>')`).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(window.webContents.getURL(), rendererUrl, 'main-frame navigation escaped renderer');
    const iframeTopNavigation = await window.webContents.executeJavaScript(`(async () => {
      const frame = document.createElement('iframe');
      frame.srcdoc = '<a id="escape" target="_top" href="data:text/html,<h1>iframe escaped</h1>">escape</a>';
      document.body.appendChild(frame);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('GrapesJS-style child frame did not load')), 2000);
        frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      frame.contentDocument.getElementById('escape').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      frame.remove();
      return true;
    })()`);
    assert.strictEqual(iframeTopNavigation, true);
    assert.strictEqual(window.webContents.getURL(), rendererUrl, 'iframe target=_top escaped renderer');
    const windowCount = BrowserWindow.getAllWindows().length;
    await window.webContents.executeJavaScript(`window.open('data:text/html,<h1>blocked</h1>'); true`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(BrowserWindow.getAllWindows().length, windowCount, 'window.open was not denied');

    assert.deepStrictEqual(
      await window.webContents.executeJavaScript('window.clay.loadWorkspace()'),
      { status: 'missing', json: null },
    );
    assert.strictEqual(main.sanitizeDefaultFileName('页面 你好.html', 'fallback.html'), '页面 你好.html');
    assert.strictEqual(main.sanitizeDefaultFileName('/tmp/页面\\最终.html', 'fallback.html'), '最终.html');
    assert.strictEqual(main.sanitizeDefaultFileName('bad:name?.html', 'fallback.html'), 'bad-name-.html');

    // If author JS were restored, it would make the page over 30000px tall and fail.
    const scriptSentinel = '<!doctype html><html><head><style>body{margin:0}</style></head>'
      + '<body><div style="height:120px">safe snapshot</div>'
      + '<script>document.body.style.height="40000px";document.body.textContent="executed"</script>'
      + '</body></html>';
    const safeResult = await invokePdf(window, safePdf, scriptSentinel);
    assert.strictEqual(safeResult.ok, true, JSON.stringify(safeResult));
    assert(fs.statSync(safePdf).size > 100, 'normal PDF was not written');
    assert.match(fs.readFileSync(safePdf).subarray(0, 5).toString(), /^%PDF-/);

    const remoteSnapshot = '<!doctype html><html><head><style>body{margin:0}</style></head><body>'
      + `<img src="${fixtureBase}/pixel.png" width="1" height="1">`
      + `<script src="${fixtureBase}/blocked.js"></script>`
      + '<script>document.body.style.height="40000px"</script></body></html>';
    const remoteResult = await invokePdf(window, remotePdf, remoteSnapshot);
    assert.strictEqual(remoteResult.ok, true, JSON.stringify(remoteResult));
    assert(fs.statSync(remotePdf).size > 100, 'remote passive-resource PDF was not written');
    assert(fixtureRequests.includes('/pixel.png'), 'remote image was not allowed into PDF snapshot');
    assert(!fixtureRequests.includes('/blocked.js'), 'script resource was requested during PDF snapshot');

    fs.mkdirSync(atomicFailurePdf);
    const atomicFailure = await invokePdf(window, atomicFailurePdf, '<!doctype html><body>atomic failure</body>');
    assert.strictEqual(atomicFailure.ok, false, JSON.stringify(atomicFailure));
    assert(fs.statSync(atomicFailurePdf).isDirectory(), 'failed PDF write replaced the existing destination');

    const tooTall = '<!doctype html><html><body><div style="height:30001px">too tall</div>'
      + '</body></html>';
    const tallResult = await invokePdf(window, tallPdf, tooTall);
    assert.strictEqual(tallResult.ok, false, JSON.stringify(tallResult));
    assert.match(tallResult.error, /30000/);
    assert.strictEqual(fs.existsSync(tallPdf), false, 'failed PDF must not be created');

    const tooWide = '<!doctype html><html><body><div style="width:4001px;height:120px">too wide</div>'
      + '</body></html>';
    const wideResult = await invokePdf(window, widePdf, tooWide);
    assert.strictEqual(wideResult.ok, false, JSON.stringify(wideResult));
    assert.match(wideResult.error, /4000/);
    assert.strictEqual(fs.existsSync(widePdf), false, 'overwide PDF must not be created');

    const tooLargeSurface = '<!doctype html><html><head><style>html,body{margin:0}</style></head>'
      + '<body><div style="width:4000px;height:16000px">surface too large</div></body></html>';
    const surfaceResult = await invokePdf(window, surfacePdf, tooLargeSurface);
    assert.strictEqual(surfaceResult.ok, false, JSON.stringify(surfaceResult));
    assert.match(surfaceResult.error, /安全上限|surface|60000000/);
    assert.strictEqual(fs.existsSync(surfacePdf), false, 'unsafe device-scaled surface must not be created');

    assert.strictEqual(await window.webContents.executeJavaScript(`window.clay.readPath(${JSON.stringify(allowedHtml)})`), null);
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.writeFile(${JSON.stringify(allowedHtml)}, 'blocked')`)).ok, false);
    const capabilityWorkspace = JSON.stringify({
      docs: [],
      recents: [
        { path: allowedHtml, name: 'allowed' },
        { path: watchA, name: 'watch-a' },
        { path: watchB, name: 'watch-b' },
        { path: missingWatch, name: 'watch-missing' },
      ],
      sessionOpen: false,
    });
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.saveWorkspace(${JSON.stringify(capabilityWorkspace)})`)).ok, true);
    assert.strictEqual(
      (await window.webContents.executeJavaScript(`window.clay.readPath(${JSON.stringify(allowedHtml)})`)).content,
      '<!doctype html><body>allowed</body>',
      'workspace migration must authorize persisted paths without an app restart',
    );
    const capabilityLoad = await window.webContents.executeJavaScript('window.clay.loadWorkspace()');
    assert.strictEqual(capabilityLoad.status, 'valid');
    assert.strictEqual(capabilityLoad.source, 'primary');
    assert.deepStrictEqual(JSON.parse(capabilityLoad.json).recents.map((recent) => recent.path), [allowedHtml, watchA, watchB, missingWatch]);
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.readPath(${JSON.stringify(allowedHtml)})`)).content, '<!doctype html><body>allowed</body>');
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.writeFile(${JSON.stringify(allowedHtml)}, 'allowed')`)).ok, true);

    // A path capability is invalid as soon as the file itself becomes a symlink.
    fs.symlinkSync(replacementHtml, symlinkHtml);
    assert.strictEqual(await window.webContents.executeJavaScript(`window.clay.readPath(${JSON.stringify(symlinkHtml)})`), null);
    fs.unlinkSync(allowedHtml);
    fs.symlinkSync(replacementHtml, allowedHtml);
    assert.strictEqual(await window.webContents.executeJavaScript(`window.clay.readPath(${JSON.stringify(allowedHtml)})`), null);
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.writeFile(${JSON.stringify(allowedHtml)}, 'replaced')`)).ok, false);
    fs.unlinkSync(allowedHtml);
    fs.writeFileSync(allowedHtml, '<!doctype html><body>allowed</body>', 'utf8');
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.writeFile(${JSON.stringify(allowedHtml)}, 'allowed-again')`)).ok, true);

    // An old watcher's error must not stop the newer watch for the same sender.
    await window.webContents.executeJavaScript(`window.__watchEvents = []; window.clay.onSourceChanged((change) => window.__watchEvents.push(change)); true`);
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.watchSource(${JSON.stringify(watchA)})`)).ok, true);
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.watchSource(${JSON.stringify(watchB)})`)).ok, true);
    await window.webContents.executeJavaScript('window.clay.testTriggerStaleWatchError()');
    assert.strictEqual(await window.webContents.executeJavaScript('window.clay.testSourceWatchPath()'), fs.realpathSync.native(watchB),
      'new source watcher stopped by stale watcher error');
    await window.webContents.executeJavaScript('window.clay.unwatchSource()');

    // A watched pathname can be replaced after capability validation. Never
    // follow a later symlink or expose the target bytes to the renderer.
    await window.webContents.executeJavaScript('window.__watchEvents = []');
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.watchSource(${JSON.stringify(watchB)})`)).ok, true);
    fs.unlinkSync(watchB);
    fs.symlinkSync(replacementHtml, watchB);
    let unsafeWatch = null;
    for (let attempt = 0; attempt < 30 && !unsafeWatch; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      unsafeWatch = await window.webContents.executeJavaScript(`window.__watchEvents.find((event) =>
        event.path === ${JSON.stringify(fs.realpathSync.native(testDir) + path.sep + path.basename(watchB))}
        && event.exists === null) || null`);
    }
    assert(unsafeWatch, 'symlink replacement did not invalidate the source watcher');
    assert.strictEqual(await window.webContents.executeJavaScript('window.clay.testSourceWatchPath()'), null);
    assert.strictEqual(await window.webContents.executeJavaScript(
      `window.__watchEvents.some((event) => event.exists === true && /replacement/.test(event.content || ''))`,
    ), false, 'symlink target content leaked through the source watcher');
    fs.unlinkSync(watchB);
    fs.writeFileSync(watchB, '<!doctype html><body>watch-b</body>', 'utf8');

    // Starting on an already-missing authorized source must still watch its
    // parent directory so an external recreation is delivered immediately.
    await window.webContents.executeJavaScript('window.__watchEvents = []');
    const missingWatchStart = await window.webContents.executeJavaScript(`window.clay.watchSource(${JSON.stringify(missingWatch)})`);
    assert.deepStrictEqual(missingWatchStart, {
      ok: true,
      path: fs.realpathSync.native(testDir) + path.sep + path.basename(missingWatch),
      exists: false,
    });
    fs.writeFileSync(missingWatch, '<!doctype html><body>recreated</body>', 'utf8');
    let recreated = null;
    for (let attempt = 0; attempt < 30 && !recreated; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      recreated = await window.webContents.executeJavaScript(`window.__watchEvents.find((event) =>
        event.path === ${JSON.stringify(fs.realpathSync.native(missingWatch))} && event.exists === true) || null`);
    }
    assert(recreated, 'recreated missing source was not delivered by the directory watcher');
    assert.match(recreated.content, /recreated/);
    await window.webContents.executeJavaScript('window.clay.unwatchSource()');

    const first = JSON.stringify({ docs: [{ id: 'first' }], recents: [], docSeq: 1, sessionOpen: true });
    const second = JSON.stringify({ docs: [{ id: 'second' }], recents: [], docSeq: 2, sessionOpen: true });
    const third = JSON.stringify({ docs: [{ id: 'third' }], recents: [], docSeq: 3, sessionOpen: true });
    const fourth = JSON.stringify({ docs: [{ id: 'fourth' }], recents: [], docSeq: 4, sessionOpen: true });
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.saveWorkspace(${JSON.stringify(first)})`)).ok, true);
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.saveWorkspace(${JSON.stringify(second)})`)).ok, true);
    const workspacePath = path.join(userData, 'workspace.json');
    const backupPath = workspacePath + '.bak';
    fs.writeFileSync(workspacePath, '{not valid workspace', 'utf8');
    const recovered = await window.webContents.executeJavaScript('window.clay.loadWorkspace()');
    assert.deepStrictEqual(recovered, { status: 'valid', source: 'backup', json: JSON.stringify({ docs: [{ id: 'first' }], recents: [], docSeq: 1, sessionOpen: true }) });
    const thirdResult = await window.webContents.executeJavaScript(`window.clay.saveWorkspace(${JSON.stringify(third)})`);
    assert.strictEqual(thirdResult.ok, true);
    assert(thirdResult.corruptCopies.some((filePath) => filePath.includes('.corrupt-')));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupPath, 'utf8')).docs.map((doc) => doc.id), ['first']);

    fs.writeFileSync(workspacePath, '{bad primary', 'utf8');
    fs.writeFileSync(backupPath, '{bad backup', 'utf8');
    assert.deepStrictEqual(await window.webContents.executeJavaScript('window.clay.loadWorkspace()'), { status: 'corrupt', json: null });
    const fourthResult = await window.webContents.executeJavaScript(`window.clay.saveWorkspace(${JSON.stringify(fourth)})`);
    assert.strictEqual(fourthResult.ok, true);
    assert.strictEqual(fourthResult.corruptCopies.length, 2);
    assert(fourthResult.corruptCopies.some((filePath) => filePath.includes('workspace.json.corrupt-')));
    assert(fourthResult.corruptCopies.some((filePath) => filePath.includes('workspace.json.bak.corrupt-')));

    // Missing and legacy (no recents) workspaces are distinct and normalized.
    fs.unlinkSync(workspacePath);
    fs.unlinkSync(backupPath);
    assert.deepStrictEqual(await window.webContents.executeJavaScript('window.clay.loadWorkspace()'), { status: 'missing', json: null });
    const legacy = JSON.stringify({ docs: [], sessionOpen: false });
    assert.strictEqual((await window.webContents.executeJavaScript(`window.clay.saveWorkspace(${JSON.stringify(legacy)})`)).ok, true);
    const legacyLoad = await window.webContents.executeJavaScript('window.clay.loadWorkspace()');
    assert.strictEqual(legacyLoad.status, 'valid');
    assert.deepStrictEqual(JSON.parse(legacyLoad.json).recents, []);

    succeeded = true;
    process.stdout.write('main-process-regression-test: ok\n');
  } catch (err) {
    failure = err;
    process.exitCode = 1;
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
  } finally {
    if (!succeeded && !failure) process.exitCode = 1;
    app.once('quit', () => {
      if (fixtureServer) {
        try { fixtureServer.close(); } catch (err) { /* best effort */ }
        fixtureServer = null;
      }
      if (succeeded && !process.exitCode) {
        try {
          fs.rmSync(testDir, { recursive: true, force: true });
        } catch (err) {
          process.stderr.write(`main-process-regression-test: cleanup failed; diagnostics retained at ${testDir}: ${err.message}\n`);
          process.exitCode = 1;
          process.exit(1);
        }
      } else {
        process.stderr.write(`main-process-regression-test: retained diagnostics at ${testDir}\n`);
        process.exitCode = 1;
        process.exit(1);
      }
    });
    for (const candidate of BrowserWindow.getAllWindows()) {
      if (!candidate.isDestroyed()) candidate.destroy();
    }
    if (fixtureServer) {
      try { fixtureServer.close(); } catch (err) { /* best effort */ }
      fixtureServer = null;
    }
    app.quit();
  }
});
