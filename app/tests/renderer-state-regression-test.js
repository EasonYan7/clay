/* Renderer state/security regressions that are easiest to verify in a real
 * GrapesJS canvas: RTE flush at export/save boundaries, baseline CSS dirty
 * detection, empty external files, and active HTML attribute filtering. */
const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-renderer-state-'));
app.setPath('userData', path.join(testDir, 'user-data'));
const preloadPath = path.join(testDir, 'preload.js');
fs.writeFileSync(preloadPath, `
  window.__sourceContents = Object.create(null);
  window.__sourceHandler = null;
  window.__writes = [];
  window.__copied = '';
  window.__confirmResponse = 0;
  window.__confirmCalls = 0;
  window.__workspaceValue = null;
  window.__workspaceDelay = 0;
  window.__workspaceWrites = [];
  window.__closeHandler = null;
  window.__closeResult = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value) => { window.__copied = value; } },
  });
  window.clay = {
    loadWorkspace: async () => ({ status: 'missing', json: null }),
    saveWorkspace: async (json) => {
      const delay = Number(window.__workspaceDelay) || 0;
      window.__workspaceWrites.push({ kind: 'async-start', json });
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      window.__workspaceValue = json;
      window.__workspaceWrites.push({ kind: 'async-done', json });
      return { ok: true };
    },
    saveWorkspaceSync: (json) => {
      window.__workspaceValue = json;
      window.__workspaceWrites.push({ kind: 'sync', json });
      return true;
    },
    onRequestClose: (cb) => { window.__closeHandler = cb; },
    respondToClose: (ok) => { window.__closeResult = !!ok; },
    onSourceChanged: (cb) => { window.__sourceHandler = cb; },
    watchSource: async (filePath) => ({ ok: true, path: filePath, content: window.__sourceContents[filePath] || '' }),
    unwatchSource: async () => {},
    writeFile: async (filePath, content) => {
      window.__writes.push({ filePath, content });
      window.__sourceContents[filePath] = content;
      return { ok: true };
    },
    confirm: async () => { window.__confirmCalls++; return window.__confirmResponse; },
  };
`, 'utf8');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

app.whenReady().then(async () => {
  let failed = false;
  let succeeded = false;
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { preload: preloadPath, contextIsolation: false, nodeIntegration: false, sandbox: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await wait(500);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const parsed = window.ClayImporter.parseOnly(
        '<!doctype html><html lang="zh" data-ok="1" onload="alert(1)">' +
        '<head><meta http-equiv="refresh" content="0;url=javascript:alert(1)">' +
        '<meta name="description" content="keep"><style>.author{color:ORANGE}</style></head>' +
        '<body data-layout="keep" onclick="alert(2)">' +
        '<a id="bad" href="java\\nscript:alert(3)" data-label="keep">bad</a>' +
        '<iframe src="local.html" srcdoc="<script>alert(4)</script>" width="10"></iframe>' +
        '<object data="local.html" title="keep"></object><embed src="local.html" data-note="keep">' +
        '</body></html>',
      );
      const safe = {
        htmlAttrs: parsed.htmlAttrs,
        bodyAttrs: parsed.bodyAttrs,
        bodyHtml: parsed.bodyHtml,
        headNodes: parsed.headNodes,
      };

      const raw = '<!doctype html><html><head><style>.author{color:ORANGE}</style></head>' +
        '<body><div class="author"><p id="copy-target">Before</p></div></body></html>';
      window.__sourceContents['/tmp/renderer-state.html'] = raw;
      await window.__clay.runImport(raw, 'renderer-state', '/tmp/renderer-state.html');
      await wait(450);
      const d = window.__clay.getDocs()[0];
      const ed = window.__clayEditor;

      // A delayed async workspace save must be drained before the synchronous
      // closed-session marker is written.  Otherwise the older save can land
      // after close and resurrect the open tabs on the next launch.
      const raceDocId = d.id;
      window.__workspaceDelay = 180;
      await window.__clay.runImport('<!doctype html><html><body><h1>Pending workspace save</h1></body></html>', 'workspace-race', '/tmp/workspace-race.html');
      await wait(20);
      const racePendingStarted = window.__workspaceWrites.some((item) => item.kind === 'async-start' && /workspace-race/.test(item.json || ''));
      const closePromise = window.__closeHandler && window.__closeHandler();
      await closePromise;
      const closedWorkspace = JSON.parse(window.__workspaceValue || 'null');
      const closeResult = window.__closeResult;
      window.__workspaceDelay = 0;
      await window.__clay.activateDoc(raceDocId);
      await wait(260);
      ed.Css.setRule('.author', { color: 'rgb(1, 2, 3)' });
      ed.trigger('component:styleUpdate');
      await wait(220);
      const dirtyAfterAuthorRule = d.dirty;

      let target = null;
      (function walk(comp) {
        if (String(comp.get('tagName') || '').toLowerCase() === 'p') target = comp;
        if (!target && comp.components) comp.components().forEach(walk);
      })(ed.getWrapper());
      const targetEl = target.getEl();
      const cwin = targetEl.ownerDocument.defaultView;
      targetEl.dispatchEvent(new cwin.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: cwin }));
      await wait(100);
      targetEl.textContent = 'After';
      targetEl.dispatchEvent(new cwin.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'After' }));
      await window.__clay.copyCode();
      const copiedAfterRteFlush = window.__copied;
      const editingAfterCopy = !!ed.getEditing();

      // Immediate page boundary: importing a second page while the first one still
      // has a fresh edit must flush/snapshot page 1 before page 2 takes over.
      const doc1Id = d.id;
      const raw2 = '<!doctype html><html><body><h1>Second page</h1></body></html>';
      window.__sourceContents['/tmp/renderer-state-2.html'] = raw2;
      await window.__clay.runImport(raw2, 'renderer-state-2', '/tmp/renderer-state-2.html');
      const d1AfterImport = window.__clay.getDocs().find((item) => item.id === doc1Id);
      const page1AfterBoundary = {
        dirty: d1AfterImport.dirty,
        data: JSON.parse(JSON.stringify(d1AfterImport.data || {})),
      };

      // Two tab clicks in one turn exercise the versioned async activation guard.
      const tabs = [...document.querySelectorAll('.doc-tab')];
      tabs[0].click();
      tabs[1].click();
      await wait(260);
      const activeAfterRapidSwitch = window.__clay.getActiveDocId();
      const page1AfterRapidSwitch = window.__clay.getDocs().find((item) => item.id === doc1Id);
      const page1RapidSnapshot = {
        dirty: page1AfterRapidSwitch.dirty,
        data: JSON.parse(JSON.stringify(page1AfterRapidSwitch.data || {})),
      };

      // Closing an inactive dirty page must activate it and ask, rather than
      // silently discarding its snapshotted edit.
      window.__confirmCalls = 0;
      window.__confirmResponse = 2;
      await window.__clay.closeDoc(doc1Id);
      const inactiveCloseConfirmCalls = window.__confirmCalls;
      window.__confirmResponse = 0;

      await window.__clay.saveToSource();
      const saved = window.__writes[window.__writes.length - 1].content;
      const cleanAfterSave = !d.dirty;

      const beforeEmptyHash = d.sourceHash;
      await window.__sourceHandler({ path: '/tmp/renderer-state.html', exists: true, content: '' });
      await wait(250);
      const emptyHtmlSnapshot = ed.getHtml();
      const emptyDirtySnapshot = d.dirty;
      const securityRaw = '<!doctype html><html lang="zh" onload="window.__claySentinel=1">' +
        '<head><base href="javascript:window.__claySentinel=9"><script>window.__claySentinel=(window.__claySentinel||0)+1</script>' +
        '<style>.deleted{color:red}@media print {.media-only{display:block}}</style></head>' +
        '<body onclick="window.__claySentinel=2"><img id="safe-svg" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E">' +
        '<iframe src="local.html" srcdoc="<script>window.__claySentinel=3</script>" onload="window.__claySentinel=4"></iframe>' +
        '<object data="local-object.html" title="keep"></object><embed src="local-embed.html" data-note="keep">' +
        '<a href="javascript:window.__claySentinel=5">link</a>' +
        '<script>window.__claySentinel=(window.__claySentinel||0)+10</script></body></html>';
      window.__sourceContents['/tmp/renderer-security.html'] = securityRaw;
      await window.__clay.runImport(securityRaw, 'renderer-security', '/tmp/renderer-security.html');
      await wait(500);
      const securityDoc = window.__clay.getDocs().find((item) => item.sourcePath === '/tmp/renderer-security.html');
      const securityEd = window.__clayEditor;
      const parsedSecurity = window.ClayImporter.parseOnly(securityRaw);
      const normalSecurity = window.ClayExporter.build(securityEd, securityDoc).code;
      const pdfSecurity = window.ClayExporter.buildForPdf(securityEd, securityDoc);
      const imgComponent = securityEd.getWrapper().find('img')[0];
      if (imgComponent) {
        if (imgComponent.set) imgComponent.set('src', 'replacement.png');
        else {
          const attrs = Object.assign({}, imgComponent.getAttributes ? imgComponent.getAttributes() : {}, { src: 'replacement.png' });
          if (imgComponent.setAttributes) imgComponent.setAttributes(attrs);
          else imgComponent.addAttributes(attrs);
        }
      }
      const replacedSecurity = window.ClayExporter.build(securityEd, securityDoc).code;

      // Remove both a top-level and an @media author rule. The exporter must
      // remove the baseline rule itself, not append a misleading unset rule.
      const securityRules = [];
      securityEd.Css.getRules().forEach((rule) => securityRules.push(rule));
      securityRules.forEach((rule) => {
        const selector = rule.selectorsToString ? rule.selectorsToString() : '';
        if (/\.deleted|\.media-only/.test(selector) && rule.remove) rule.remove();
      });
      if (securityEd.Css.clear) securityEd.Css.clear();
      securityEd.trigger('component:styleUpdate');
      await wait(280);
      const deletionCode = window.ClayExporter.build(securityEd, securityDoc).code;
      const legacySafe = window.ClayImporter.sanitizeWorkspaceDocument({
        htmlAttrs: { lang: 'zh', onload: 'window.__legacy=1', 'data-theme': 'keep' },
        bodyAttrs: { onclick: 'window.__legacy=2', 'data-layout': 'keep' },
        headNodes: [{ tag: 'style', html: '<meta name="description" content="ok">' }, { tag: 'script', html: '<script>window.__legacy=3</script>' }],
        data: { components: [
          { tagName: 'script', script: 'window.__legacy=4' },
          { tagName: 'div', attributes: { onload: 'window.__legacy=5', href: 'javascript:1', 'data-keep': 'yes' }, components: '<img onerror="window.__legacy=6">' },
          { type: 'textnode', content: '<b>literal text</b>' },
        ] },
      });
      const legacyText = JSON.stringify(legacySafe);
      const legacyCanvasText = JSON.stringify({
        data: legacySafe.data,
        htmlAttrs: legacySafe.safeHtmlAttrs,
        bodyAttrs: legacySafe.safeBodyAttrs,
        headNodes: legacySafe.safeHeadNodes,
      });
      // The renderer remains alive in this harness after the close response;
      // late editor/scheduled events must not reopen the persisted session.
      await wait(980);
      const closedWorkspaceAfterLateEvents = JSON.parse(window.__workspaceValue || 'null');
      return {
        safe,
        dirtyAfterAuthorRule,
        copiedAfterRteFlush,
        editingAfterCopy,
        page1AfterBoundary,
        activeAfterRapidSwitch,
        page1AfterRapidSwitch: page1RapidSnapshot,
        inactiveCloseConfirmCalls,
        saved,
        cleanAfterSave,
        beforeEmptyHash,
        afterEmptyHash: d.sourceHash,
        emptyHtml: emptyHtmlSnapshot,
        emptyDirty: emptyDirtySnapshot,
        ready: await window.__clayReady,
        racePendingStarted,
        closeResult,
        closedWorkspace,
        closedWorkspaceAfterLateEvents,
        sentinel: window.__claySentinel,
        parsedSecurity: { htmlAttrs: parsedSecurity.htmlAttrs, bodyAttrs: parsedSecurity.bodyAttrs, bodyHtml: parsedSecurity.bodyHtml, headNodes: parsedSecurity.headNodes, baseHref: parsedSecurity.baseHref },
        normalSecurity,
        pdfSecurity,
        replacedSecurity,
        imageComponentFound: !!imgComponent,
        imageAttrs: imgComponent && imgComponent.getAttributes ? imgComponent.getAttributes() : null,
        authorActiveAttrs: securityDoc.authorActiveAttrs,
        deletionDirty: securityDoc.dirty,
        deletionCode,
        legacySafe,
        legacyText,
        legacyCanvasText,
      };
    })()`);

    assert.strictEqual(result.safe.htmlAttrs.lang, 'zh');
    assert.strictEqual(result.safe.htmlAttrs['data-ok'], '1');
    assert.ok(!('onload' in result.safe.htmlAttrs));
    assert.strictEqual(result.safe.bodyAttrs['data-layout'], 'keep');
    assert.ok(!('onclick' in result.safe.bodyAttrs));
    assert.ok(!/onload|onclick|javascript:|srcdoc=|<script/i.test(result.safe.bodyHtml));
    assert.match(result.safe.bodyHtml, /data-label="keep"/);
    assert.ok(!/iframe[^>]+\ssrc=|object[^>]+\sdata=|embed[^>]+\ssrc=/i.test(result.safe.bodyHtml));
    assert.ok(!result.safe.headNodes.some((n) => /http-equiv=["']?refresh/i.test(n.html)));
    assert.strictEqual(result.dirtyAfterAuthorRule, true);
    assert.match(result.copiedAfterRteFlush, /<p[^>]*>After<\/p>/);
    assert.strictEqual(result.editingAfterCopy, false);
    assert.strictEqual(result.page1AfterBoundary.dirty, true);
    assert.match(JSON.stringify(result.page1AfterBoundary.data), /After/);
    assert.strictEqual(result.activeAfterRapidSwitch, 'doc2');
    assert.strictEqual(result.page1AfterRapidSwitch.dirty, true);
    assert.match(JSON.stringify(result.page1AfterRapidSwitch.data), /After/);
    assert.ok(result.inactiveCloseConfirmCalls >= 1);
    assert.match(result.saved, /<p[^>]*>After<\/p>/);
    assert.strictEqual(result.cleanAfterSave, true);
    assert.notStrictEqual(result.beforeEmptyHash, result.afterEmptyHash);
    assert.strictEqual(result.emptyDirty, false);
    assert.ok(!/copy-target|Before|After/.test(result.emptyHtml));
    assert.strictEqual(result.ready.status, 'valid');
    assert.strictEqual(result.ready.writable, true);
    assert.strictEqual(result.racePendingStarted, true);
    assert.strictEqual(result.closeResult, true);
    assert.deepStrictEqual(result.closedWorkspace.docs, []);
    assert.strictEqual(result.closedWorkspace.sessionOpen, false);
    assert.deepStrictEqual(result.closedWorkspaceAfterLateEvents.docs, []);
    assert.strictEqual(result.closedWorkspaceAfterLateEvents.sessionOpen, false);
    assert.strictEqual(result.sentinel, undefined);
    assert.ok(!('onload' in result.parsedSecurity.htmlAttrs));
    assert.ok(!('onclick' in result.parsedSecurity.bodyAttrs));
    assert.strictEqual(result.parsedSecurity.baseHref, '');
    assert.ok(/data:image\/svg\+xml/i.test(result.parsedSecurity.bodyHtml));
    assert.ok(!/onload|onclick|javascript:|srcdoc=|<script/i.test(result.parsedSecurity.bodyHtml));
    assert.ok(/data-clay-author-key/.test(result.parsedSecurity.bodyHtml));
    assert.match(result.normalSecurity, /window\.__claySentinel/);
    assert.match(result.normalSecurity, /onclick=/i);
    assert.match(result.normalSecurity, /srcdoc=/i);
    assert.match(result.normalSecurity, /<iframe[^>]+src="local\.html"/i);
    assert.match(result.normalSecurity, /<object[^>]+data="local-object\.html"/i);
    assert.match(result.normalSecurity, /<embed[^>]+src="local-embed\.html"/i);
    assert.match(result.normalSecurity, /<base[^>]+href="javascript:/i);
    assert.ok(/replacement\.png/.test(result.replacedSecurity), JSON.stringify({ found: result.imageComponentFound, attrs: result.imageAttrs, author: result.authorActiveAttrs, html: result.replacedSecurity }));
    assert.ok(result.pdfSecurity && result.pdfSecurity.ok);
    assert.ok(!/<script\b|onload=|onclick=|srcdoc=|javascript:|<iframe[^>]+\ssrc=|<object[^>]+\sdata=|<embed[^>]+\ssrc=|data-clay-author-key|data-clay-script/i.test(result.pdfSecurity.code));
    assert.ok(!/color:red|display:block/.test(result.deletionCode), result.deletionCode);
    assert.strictEqual(result.deletionDirty, true);
    assert.ok(!/window\.__legacy|onload|onclick|javascript:|<script/i.test(result.legacyCanvasText));
    assert.strictEqual(result.legacySafe.safeHeadNodes[0].tag, 'meta');
    assert.strictEqual(result.legacySafe.rawHeadNodes[1].tag, 'script');
    assert.strictEqual(result.legacySafe.rawHtmlAttrs.onload, 'window.__legacy=1');
    assert.match(result.legacyText, /data-keep/);
    assert.match(result.legacyText, /literal text/);
    succeeded = true;
    process.stdout.write('renderer-state-regression: ok\n');
  } catch (err) {
    failed = true;
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
  } finally {
    if (!win.isDestroyed()) win.destroy();
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      if (succeeded && !failed) {
        fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } else {
        process.stderr.write('renderer-state-regression preserved fixtures at ' + testDir + '\n');
      }
      if (failed) process.exitCode = 1;
    };
    app.once('quit', finalize);
    app.quit();
    // Some Electron test runners tear down without emitting `quit`; preserve
    // failure fixtures and return the right status in that case as well.
    setTimeout(finalize, 1000);
  }
});
