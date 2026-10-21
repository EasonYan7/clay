const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-svg-editing-'));
app.setPath('userData', path.join(dir, 'user-data'));
const source = path.join(dir, 'source.html');
const saved = path.join(dir, 'saved.html');
const fixture = `<!doctype html><html lang="en"><head><style>
body{margin:0;background:#f5f5f5}svg{display:block;width:100%;min-width:600px}p{font:16px sans-serif}
</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" role="img" aria-labelledby="diagram-title">
<title id="diagram-title">Editable vector fixture</title>
<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#334455"/></marker></defs>
<g id="card" data-node="Review card" transform="translate(30 40) rotate(2)">
<rect id="box" x="0" y="0" width="300" height="140" rx="8" fill="#ffffff" stroke="#334455"/>
<text id="label" x="20" y="40" font-size="20" fill="#223344">Review materials</text>
<text id="multiline" x="20" y="75" fill="#445566"><tspan id="first-line" x="20">First line</tspan><tspan id="second-line" x="20" dy="20">Second line</tspan></text>
</g><path id="connector" d="M350 100 H500" fill="none" stroke="#334455" marker-end="url(#arrow)"/>
<circle id="circle" cx="600" cy="100" r="24" fill="#ddeeff"/>
</svg><p id="html-text">Ordinary HTML remains editable.</p></body></html>`;
fs.writeFileSync(source, fixture);

async function pause(ms = 220) { await new Promise((resolve) => setTimeout(resolve, ms)); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1480, height: 940, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const js = (code) => win.webContents.executeJavaScript(code).catch((err) => { console.error('Failed SVG evaluation:', code.slice(0, 200)); throw err; });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await js('Promise.resolve(window.__clayReady).then(()=>true)');
    await js(`window.clay={saveFile:async(name,code)=>{window.__svgSaved=code;return ${JSON.stringify(saved)}}};true`);
    await js(`window.__clay.runImport(${JSON.stringify(fixture)},'SVG fixture',${JSON.stringify(source)},'svg-test')`);
    await pause(800);
    const initial = await js(`(()=>{
      window.testEd=window.__clayEditor;
      window.testModel=(selector)=>testEd.getWrapper().find(selector)[0];
      const doc=testEd.Canvas.getDocument();
      window.__svgEvents=[];['pointerdown','pointermove','pointerup','pointercancel','mousedown','dblclick'].forEach(type=>doc.addEventListener(type,e=>window.__svgEvents.push({type,id:e.target.id,tag:e.target.tagName,pointer:e.pointerId}),true));
      return {text:doc.querySelectorAll('svg text').length,paths:doc.querySelectorAll('svg path').length,
        selectable:testModel('#label').get('selectable'),definitionSelectable:testModel('defs path').get('selectable'),
        dirty:window.__clay.getDocs()[0].dirty,htmlTextEditable:testModel('#html-text').get('editable')};
    })()`);
    assert.strictEqual(initial.text, 2); assert.strictEqual(initial.paths, 2);
    assert.strictEqual(initial.selectable, true); assert.strictEqual(initial.definitionSelectable, false);
    assert.strictEqual(initial.dirty, false); assert.strictEqual(initial.htmlTextEditable, true);

    async function point(selector) {
      return js(`(()=>{const r=testEd.Canvas.getDocument().querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        const f=testEd.Canvas.getFrameEl().getBoundingClientRect();
        return {x:Math.round(f.left+r.left+r.width/2),y:Math.round(f.top+r.top+r.height/2)};})()`);
    }
    async function click(selector, twice = false) {
      const p = await point(selector);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...p });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...p });
      if (twice) {
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 2, ...p });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 2, ...p });
      }
      await pause();
    }
    async function value(key, next, event = 'change') {
      await js(`(()=>{const input=document.querySelector('[data-svg-field="${key}"] input');
        input.value=${JSON.stringify(next)};input.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;})()`);
      await pause();
    }
    await click('#label', true);
    assert.strictEqual(await js('document.activeElement.id'), 'svg-text', 'double-click must focus plain-text editor');
    assert.strictEqual(await js('testEd.getSelected().getAttributes().id'), 'label');
    await value('fill', '#e15f35', 'input');
    assert.strictEqual(await js('getComputedStyle(testModel("#label").getEl()).fill'), 'rgb(225, 95, 53)');
    await js('testEd.UndoManager.undo();true'); await pause();
    assert.strictEqual(await js('getComputedStyle(testModel("#label").getEl()).fill'), 'rgb(34, 51, 68)');
    await js('testEd.UndoManager.redo();true'); await pause();
    assert.strictEqual(await js('getComputedStyle(testModel("#label").getEl()).fill'), 'rgb(225, 95, 53)');

    await js('testEd.select(testModel("#box"));true'); await value('width', '340');
    assert.strictEqual(await js('testModel("#box").getEl().getAttribute("width")'), '340');
    await js('testEd.UndoManager.undo();true'); await pause();
    assert.strictEqual(await js('testModel("#box").getEl().getAttribute("width")'), '300');
    await js('testEd.UndoManager.redo();true'); await pause();
    await js('document.querySelector("#btn-select-parent").click();true');
    assert.strictEqual(await js('testEd.getSelected().getAttributes().id'), 'card');
    const start = await point('#box');
    win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start });
    await pause(80);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + 45, y: start.y + 20 });
    await pause(80);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: start.x + 45, y: start.y + 20 });
    await pause();
    const moved = await js('testModel("#card").getAttributes().transform');
    assert.notStrictEqual(moved, 'translate(30 40) rotate(2)', 'drag must move a vector group');
    assert(moved.endsWith('rotate(2)'), 'author rotation must survive dragging');
    const afterDrag = await point('#box');
    assert(Math.abs(afterDrag.x - start.x - 45) < 2 && Math.abs(afterDrag.y - start.y - 20) < 2, 'drag must respect viewBox scaling');
    await js('testEd.UndoManager.undo();true'); await pause();
    assert.strictEqual(await js('testModel("#card").getAttributes().transform'), 'translate(30 40) rotate(2)');
    await js('testEd.UndoManager.redo();true'); await pause();
    await js(`testEd.select(testModel('#card'));testEd.Canvas.getDocument().body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));true`);
    assert.notStrictEqual(await js('testModel("#card").getAttributes().transform'), moved);

    await js('testEd.select(testModel("#first-line"));true');
    await js(`(()=>{const input=document.querySelector('#svg-text');input.value='Edited span';input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    assert.strictEqual(await js('testModel("#second-line").getEl().textContent'), 'Second line');
    assert.strictEqual(await js('testModel("#first-line").getEl().getAttribute("x")'), '20');
    await js('testEd.UndoManager.undo();true'); await pause();
    assert.strictEqual(await js('testModel("#first-line").getEl().textContent'), 'First line');
    await js('testEd.UndoManager.redo();true'); await pause();
    assert.strictEqual(await js('testModel("#first-line").getEl().textContent'), 'Edited span');

    await js('testEd.select(testModel("#label"));true');
    await js(`(()=>{const input=document.querySelector('#svg-text');input.focus();input.value='<b>审核 & 确认</b>';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    assert.strictEqual(await js('window.__clay.saveAsCopy()'), true, 'save must flush a focused SVG text field');
    const exported = await js('window.__svgSaved'); fs.writeFileSync(saved, exported);
    const checks = await js(`(()=>{const doc=new DOMParser().parseFromString(window.__svgSaved,'text/html');return {
      text:doc.querySelector('#label').textContent,htmlChildren:doc.querySelector('#label').children.length,
      spans:doc.querySelectorAll('#multiline tspan').length,second:doc.querySelector('#second-line').textContent,
      marker:doc.querySelector('#connector').getAttribute('marker-end'),viewBox:doc.querySelector('svg').getAttribute('viewBox'),
      rotated:doc.querySelector('#card').getAttribute('transform'),dirty:window.__clay.getDocs()[0].dirty};})()`);
    assert.strictEqual(checks.text, '<b>审核 & 确认</b>'); assert.strictEqual(checks.htmlChildren, 0);
    assert.strictEqual(checks.spans, 2); assert.strictEqual(checks.second, 'Second line');
    assert.strictEqual(checks.marker, 'url(#arrow)'); assert.strictEqual(checks.viewBox, '0 0 800 420');
    assert(checks.rotated.endsWith('rotate(2)')); assert.strictEqual(checks.dirty, false);
    await js('testEd.UndoManager.undo();true'); await pause();
    assert.strictEqual(await js('testModel("#label").getEl().textContent'), 'Review materials');
    assert.strictEqual(await js('window.__clay.getDocs()[0].dirty'), true);
    await js('testEd.UndoManager.redo();true'); await pause();
    assert.strictEqual(await js('testModel("#label").getEl().textContent'), '<b>审核 & 确认</b>');
    assert.strictEqual(await js('window.__clay.getDocs()[0].dirty'), false);
    fs.writeFileSync(path.join(dir, 'svg-editor.png'), (await win.webContents.capturePage()).toPNG());

    // Reload an older workspace that explicitly disabled SVG selection.
    await js(`(()=>{const data=testEd.getProjectData();const walk=c=>{if(c.type==='svg-in')c.selectable=false;(Array.isArray(c.components)?c.components:[]).forEach(walk);};data.pages.forEach(p=>p.frames.forEach(f=>walk(f.component)));testEd.loadProjectData(data);return true;})()`);
    await pause(700);
    assert.strictEqual(await js('testModel("#label").get("selectable")'), true);
    assert.strictEqual(await js('testModel("defs path").get("selectable")'), false);
    assert.strictEqual(await js('testModel("#label").getEl().textContent'), '<b>审核 & 确认</b>');
    const checkWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await checkWin.loadFile(saved);
    const reopened = await checkWin.webContents.executeJavaScript(`({text:document.querySelector('#label').textContent,fill:getComputedStyle(document.querySelector('#label')).fill,width:document.querySelector('#box').getAttribute('width')})`);
    assert.strictEqual(reopened.text, '<b>审核 & 确认</b>');
    assert.strictEqual(reopened.fill, 'rgb(225, 95, 53)'); assert.strictEqual(reopened.width, '340');
    assert.strictEqual(fs.readFileSync(source, 'utf8'), fixture, 'original fixture must remain intact');
    console.log(`SVG editing passed: selection, text safety, colors, size, group drag, keyboard, undo/redo, legacy workspace, export and reopen. Artifacts: ${dir}`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    console.error(await js(`({events:window.__svgEvents,selected:window.__clayEditor?.getSelected()?.getAttributes(),children:window.__clayEditor?.getSelected()?.components().models.map(c=>({type:c.get('type'),tag:c.get('tagName'),content:c.get('content')})),bound:window.__clayEditor?.Canvas.getDocument().__claySvgEditing,preview:window.__clayEditor?.Commands.isActive('core:preview'),panelHidden:document.querySelector('#svg-properties')?.hidden,active:document.activeElement?.outerHTML.slice(0,200)})`).catch(() => 'No renderer diagnostics'));
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    console.error(`SVG test artifacts retained: ${dir}`); app.exit(1);
  }
});
