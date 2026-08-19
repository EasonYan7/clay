const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = process.env.CLAY_EDITOR_TEST_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'clay-editor-test-'));
app.setPath('userData', path.join(testDir, 'user-data'));

const savedWorkspace = {
  docs: [{ id: 'doc1', name: '上次编辑的页面', data: {}, dirty: false }],
  activeDocId: 'doc1',
  docSeq: 1,
  recents: [
    { path: '/tmp/AHT图片生成流程复盘-20260730.html', name: 'AHT图片生成流程复盘' },
    { path: '/tmp/京桔财务全景图.html', name: '京桔财务全景图' },
    { path: '/tmp/AHT活动资源位设计输入标准.html', name: 'AHT活动资源位设计输入标准' },
    { path: '/tmp/AI比赛心得分享一.html', name: 'AI比赛心得分享一' },
    { path: '/tmp/AI比赛心得分享二.html', name: 'AI比赛心得分享二' },
  ],
};
const preloadPath = path.join(testDir, 'seed-workspace.js');
fs.writeFileSync(
  preloadPath,
  `if (!localStorage.getItem('clay-workspace-v1')) localStorage.setItem('clay-workspace-v1', ${JSON.stringify(JSON.stringify(savedWorkspace))});
   window.__closeResponse = 2;
   window.__closeDecision = null;
   window.__confirmCalls = 0;
   window.__saveCalls = 0;
   window.clay = {
     confirm: async (opts) => {
       window.__confirmCalls++;
       window.__lastConfirm = opts;
       return window.__closeResponse;
     },
     onRequestClose: (cb) => { window.__closeHandler = cb; },
     respondToClose: (decision) => { window.__closeDecision = decision; },
     saveFile: async () => {
       window.__saveCalls++;
       return '/tmp/clay-editor-behavior-saved.html';
     }
   };`,
  'utf8',
);

function timed(promise, label, ms = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

app.whenReady().then(async () => {
  let failed = false;
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: false, nodeIntegration: false, sandbox: false },
  });

  try {
    const entry = path.join(__dirname, '..', 'renderer', 'index.html');
    await timed(win.loadFile(entry), 'loadFile');

    const startup = await timed(win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        if (!window.__clay) {
          if (Date.now() < deadline) return setTimeout(check, 25);
          return reject(new Error('Clay renderer did not initialize'));
        }
        resolve({
          homeVisible: !document.querySelector('#empty-state').hidden,
          sidebarHidden: document.querySelector('#sidebar').hidden,
          activeDocId: window.__clay.getActiveDocId(),
          activeTabs: document.querySelectorAll('.doc-tab.active').length,
          docs: window.__clay.getDocs().length,
          intro: document.querySelector('.empty-left > p').textContent,
          recentCount: document.querySelectorAll('.recent-card').length,
          recentPathContained: Array.from(document.querySelectorAll('.recent-card')).every((card) => {
            const path = card.querySelector('.rc-path');
            return path.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5
              && getComputedStyle(card).overflow === 'hidden';
          }),
        });
      };
      setTimeout(check, 300);
    })`), 'startup state');

    assert.deepStrictEqual(startup, {
      homeVisible: true,
      sidebarHidden: true,
      activeDocId: null,
      activeTabs: 0,
      docs: 0,
      intro: '打开或粘贴 AI 生成的 HTML，自由调整内容与样式，再导出干净的代码。',
      recentCount: 5,
      recentPathContained: true,
    });

    const cell = await timed(win.webContents.executeJavaScript(`new Promise(async (resolve, reject) => {
      try {
        await window.__clay.runImport(
          '<!doctype html><html><body><table><tbody><tr><th>审核项</th><td>原始内容</td></tr></tbody></table></body></html>',
          'table-edit-test',
          '/tmp/table-edit-test.html'
        );
        await new Promise((r) => setTimeout(r, 180));
        const ed = window.__clayEditor;
        let comp = null;
        (function walk(node) {
          if (String(node.get('tagName') || '').toLowerCase() === 'td') comp = node;
          if (!comp && node.components) node.components().forEach(walk);
        })(ed.getWrapper());
        if (!comp) throw new Error('td component missing: ' + ed.getHtml());
        const el = comp.getEl();
        const canvasWindow = el.ownerDocument.defaultView;
        el.dispatchEvent(new canvasWindow.MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: canvasWindow,
        }));
        await new Promise((r) => setTimeout(r, 120));
        const editingAfterDoubleClick = ed.getEditing() === comp
          && el.getAttribute('contenteditable') === 'true';
        el.textContent = '修改后的内容';
        el.dispatchEvent(new canvasWindow.InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: '修改后的内容',
        }));
        // 不点击画布其他位置,直接模拟系统菜单的退出请求。
        const activeDoc = window.__clay.getDocs().find((d) => d.id === window.__clay.getActiveDocId());
        const dirtyBeforeClose = activeDoc.dirty;

        window.__closeResponse = 2;
        window.__closeDecision = null;
        await window.__closeHandler();
        const cancelDecision = window.__closeDecision;
        const dirtyAfterCancel = activeDoc.dirty;
        const editingAfterCloseRequest = !!ed.getEditing();
        const historyAfterCloseRequest = document.querySelector('#history-mount').textContent;

        window.__closeResponse = 1;
        window.__closeDecision = null;
        await window.__closeHandler();
        const directDecision = window.__closeDecision;
        const dirtyAfterDirect = activeDoc.dirty;
        const workspaceAfterDirect = JSON.parse(localStorage.getItem('clay-workspace-v1'));

        window.__closeResponse = 0;
        window.__closeDecision = null;
        await window.__closeHandler();
        const saveDecision = window.__closeDecision;
        const dirtyAfterSave = activeDoc.dirty;
        const confirmCallsAfterSave = window.__confirmCalls;

        window.__closeDecision = null;
        await window.__closeHandler();
        const cleanDecision = window.__closeDecision;
        resolve({
          type: comp.get('type'),
          name: comp.getName(),
          editable: comp.get('editable'),
          editingAfterDoubleClick,
          html: ed.getHtml(),
          dirtyBeforeClose,
          cancelDecision,
          dirtyAfterCancel,
          editingAfterCloseRequest,
          historyAfterCloseRequest,
          directDecision,
          dirtyAfterDirect,
          docsAfterDirect: workspaceAfterDirect.docs.length,
          sessionOpenAfterDirect: workspaceAfterDirect.sessionOpen,
          saveDecision,
          dirtyAfterSave,
          cleanDecision,
          confirmCallsAfterSave,
          confirmCallsFinal: window.__confirmCalls,
          saveCalls: window.__saveCalls,
          buttons: window.__lastConfirm.buttons,
          detail: window.__lastConfirm.detail,
        });
      } catch (err) {
        reject(err);
      }
    })`), 'table cell edit');

    assert.strictEqual(cell.type, 'cell');
    assert.strictEqual(cell.editable, true);
    assert.match(cell.name, /^单元格/);
    assert.strictEqual(cell.editingAfterDoubleClick, true);
    assert.match(cell.html, /<td>修改后的内容<\/td>/);
    assert.strictEqual(cell.dirtyBeforeClose, false);
    assert.strictEqual(cell.cancelDecision, false);
    assert.strictEqual(cell.dirtyAfterCancel, true);
    assert.strictEqual(cell.editingAfterCloseRequest, false);
    assert.match(cell.historyAfterCloseRequest, /修改/);
    assert.strictEqual(cell.directDecision, true);
    assert.strictEqual(cell.dirtyAfterDirect, true);
    assert.strictEqual(cell.docsAfterDirect, 0);
    assert.strictEqual(cell.sessionOpenAfterDirect, false);
    assert.strictEqual(cell.saveDecision, true);
    assert.strictEqual(cell.dirtyAfterSave, false);
    assert.strictEqual(cell.cleanDecision, true);
    assert.strictEqual(cell.confirmCallsAfterSave, 3);
    assert.strictEqual(cell.confirmCallsFinal, 3);
    assert.strictEqual(cell.saveCalls, 1);
    assert.deepStrictEqual(cell.buttons, ['保存并退出', '直接退出', '取消']);
    assert.match(cell.detail, /直接退出.*丢弃未保存修改/);

    // 只有带 sessionOpen=true 的异常中断工作区才恢复；恢复后选择“直接退出”，
    // 下一次启动必须回到零标签主页，且不能再弹同一份未保存修改。
    const crashWorkspace = {
      docs: [{ id: 'crash1', name: '异常中断恢复页', data: {}, dirty: true }],
      activeDocId: null,
      docSeq: 1,
      recents: savedWorkspace.recents,
      sessionOpen: true,
    };
    await win.webContents.executeJavaScript(
      `localStorage.setItem('clay-workspace-v1', ${JSON.stringify(JSON.stringify(crashWorkspace))})`,
    );
    let loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.webContents.reload();
    await timed(loaded, 'reload crash workspace');
    const recovered = await timed(win.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(() => resolve({
      docs: window.__clay.getDocs().length,
      home: !document.querySelector('#empty-state').hidden,
    }), 300))`), 'recover crash workspace');
    assert.deepStrictEqual(recovered, { docs: 1, home: true });

    await win.webContents.executeJavaScript(`(async () => {
      window.__closeResponse = 1;
      await window.__closeHandler();
    })()`);
    loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.webContents.reload();
    await timed(loaded, 'reload discarded workspace');
    const discarded = await timed(win.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(() => resolve({
      docs: window.__clay.getDocs().length,
      home: !document.querySelector('#empty-state').hidden,
      confirmCalls: window.__confirmCalls,
    }), 300))`), 'verify discarded workspace');
    assert.deepStrictEqual(discarded, { docs: 0, home: true, confirmCalls: 0 });
    process.stdout.write('editor-behavior.e2e: ok\n');
  } catch (err) {
    failed = true;
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
  } finally {
    if (!win.isDestroyed()) win.destroy();
    app.exit(failed ? 1 : 0);
  }
});
