const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-fidelity-test-'));
app.setPath('userData', path.join(testDir, 'user-data'));

const fixture = `<!doctype html>
<html lang="en" class="night" data-theme="midnight">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=777, initial-scale=0.8">
  <title>Fidelity fixture</title>
  <style>:root{--tone:rgb(11,12,13)} #probe{color:red;background:var(--tone)}</style>
  <link rel="stylesheet" href="fidelity.css">
  <style media="print">#probe{font-size:99px}</style>
  <script type="application/json" data-head>{"where":"head"}</script>
</head>
<body data-layout="editorial" style="margin:7px">
  <style data-body-style>.body-only{letter-spacing:1px}</style>
  <div id="probe" class="body-only">probe</div>
  <script type="application/json" data-body>{"where":"body"}</script>
  <pre id="spacing">  alpha
    beta</pre>
</body>
</html>`;
const fixturePath = path.join(testDir, 'fidelity.html');
fs.writeFileSync(fixturePath, fixture, 'utf8');
fs.writeFileSync(path.join(testDir, 'fidelity.css'), '#probe{color:rgb(1,2,3)}', 'utf8');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForClayReady(win) {
  await win.webContents.executeJavaScript(`(async () => {
    if (!window.__clayReady) throw new Error('window.__clayReady is missing');
    await window.__clayReady;
    return true;
  })()`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await waitForClayReady(win);
    await wait(500);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const raw = ${JSON.stringify(fixture)};
      await window.__clay.runImport(raw, 'fidelity-fixture', ${JSON.stringify(fixturePath)}, 'fidelity-test');
      await new Promise((r) => setTimeout(r, 2300));
      const d = window.__clay.getDocs()[0];
      const ed = window.__clayEditor;
      const cdoc = ed.Canvas.getDocument();
      const probe = cdoc.getElementById('probe');
      const before = cdoc.defaultView.getComputedStyle(probe);
      const beforeColor = before.color;
      const beforeBackground = before.backgroundColor;
      const beforeFontSize = before.fontSize;

      // 模拟 componentFirst 对作者已有 #id 的修改。原 CSS 与外链样式均在后置
      // fidelity head 中,Clay override 必须再压到它们后面。
      ed.Css.setRule('#probe', { color: 'rgb(9, 8, 7)' });
      ed.trigger('component:styleUpdate');
      await new Promise((r) => setTimeout(r, 80));
      const exported = window.ClayExporter.build(ed, d).code;
      const headOrder = [...cdoc.querySelectorAll('style,link[rel="stylesheet"]')].map((n) =>
        n.id || (n.hasAttribute('data-clay-fidelity') ? 'fidelity-' + n.tagName.toLowerCase() : n.tagName.toLowerCase()));
      return {
        htmlClass: cdoc.documentElement.className,
        htmlTheme: cdoc.documentElement.getAttribute('data-theme'),
        bodyLayout: ed.getWrapper().getEl().getAttribute('data-layout'),
        wrapperTag: ed.getWrapper().getEl() && ed.getWrapper().getEl().tagName,
        wrapperAttrs: ed.getWrapper().getAttributes(),
        wrapperOuter: ed.getWrapper().getEl() && ed.getWrapper().getEl().outerHTML.slice(0, 220),
        bodyMargin: cdoc.defaultView.getComputedStyle(ed.getWrapper().getEl()).marginTop,
        fidelityLinks: cdoc.querySelectorAll('link[data-clay-fidelity]').length,
        fidelityHref: cdoc.querySelector('link[data-clay-fidelity]') && cdoc.querySelector('link[data-clay-fidelity]').href,
        fidelitySheet: !!(cdoc.querySelector('link[data-clay-fidelity]') && cdoc.querySelector('link[data-clay-fidelity]').sheet),
        beforeColor, beforeBackground, beforeFontSize,
        afterColor: cdoc.defaultView.getComputedStyle(probe).color,
        headOrder,
        allCssNodes: [...cdoc.querySelectorAll('style,link[rel="stylesheet"]')].map((n) => ({
          parent: n.parentElement && n.parentElement.tagName,
          fidelity: n.hasAttribute('data-clay-fidelity'),
          id: n.id,
          text: (n.textContent || '').slice(0, 100),
        })),
        exported,
        headTags: d.headNodes.map((n) => n.tag),
        viewport: d.viewport,
        tailwindConfig: window.ClayImporter.parseOnly('<script>tailwind.config={theme:{extend:{colors:{brand:"#123456"},spacing:{hero:"72px"}}}}</script>').tailwindConfig,
        rejectedConfig: window.ClayImporter.parseOnly('<script>tailwind.config={theme:fetch("https://bad.invalid")}</script>').tailwindConfig,
      };
    })()`);

    if (process.env.CLAY_TEST_DEBUG) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    assert.strictEqual(result.htmlClass, 'night');
    assert.strictEqual(result.htmlTheme, 'midnight');
    assert.strictEqual(result.bodyLayout, 'editorial');
    assert.strictEqual(result.bodyMargin, '7px');
    assert.strictEqual(result.fidelityLinks, 1);
    assert.strictEqual(result.beforeColor, 'rgb(1, 2, 3)');
    assert.strictEqual(result.beforeBackground, 'rgb(11, 12, 13)');
    assert.notStrictEqual(result.beforeFontSize, '99px');
    assert.strictEqual(result.afterColor, 'rgb(9, 8, 7)');
    assert.deepStrictEqual(result.headTags, ['style', 'link', 'style', 'script', 'style']);
    assert.strictEqual(result.viewport, 'width=777, initial-scale=0.8');
    assert.strictEqual(result.tailwindConfig.theme.extend.colors.brand, '#123456');
    assert.strictEqual(result.tailwindConfig.theme.extend.spacing.hero, '72px');
    assert.strictEqual(result.rejectedConfig, null);
    assert.ok(result.headOrder.indexOf('clay-overrides') > result.headOrder.lastIndexOf('fidelity-style'));

    const out = result.exported;
    assert.match(out, /<html[^>]*lang="en"[^>]*class="night"[^>]*data-theme="midnight"/);
    assert.match(out, /<meta name="viewport" content="width=777, initial-scale=0.8">/);
    assert.match(out, /<style media="print">#probe\{font-size:99px\}<\/style>/);
    assert.match(out, /<style data-body-style(?:="")?>\.body-only\{letter-spacing:1px\}<\/style>/);
    assert.match(out, /<link rel="stylesheet" href="fidelity\.css">/);
    assert.ok(out.indexOf('data-head') < out.indexOf('</head>'));
    assert.ok(out.indexOf('data-body=""') > out.indexOf('<div id="probe"'));
    assert.ok(out.indexOf('data-body=""') < out.indexOf('<pre id="spacing"'));
    assert.ok(out.includes('  alpha\n    beta'));
    // The export marker is localized by the app locale; the CSS payload is
    // the invariant under test, not the human-language label around it.
    assert.match(out, /\/\* (?:Clay 中调整的部分|Adjustments made in Clay) \*\/[\s\S]*#probe\{color:rgb\(9, 8, 7\);\}/);

    process.stdout.write('fidelity.e2e: ok\n');
  } catch (err) {
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
    process.exitCode = 1;
  } finally {
    try { win.destroy(); } catch (e) { /* already closed */ }
    // Chromium may still flush profile files after the window is destroyed.
    // Clean only after Electron has emitted `quit`, otherwise the recursive
    // delete races the helper process and leaves flaky ENOENT/EBUSY failures.
    app.once('quit', () => {
      if (!process.exitCode) fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      else process.stderr.write(`fidelity test data preserved at ${testDir}\n`);
    });
    app.quit();
  }
});
