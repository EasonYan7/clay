// Drives the Clay renderer headlessly and captures README screenshots + GIF frames.
// Usage: see scripts/readme-assets/build.sh
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [outDir, locale = 'en-US', mode = 'stills'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APP_DIR = process.cwd();
const W = 1440;
const H = 900;
// The sample page is English in both locales, so the demo edit is the same.
const COPY = { title: 'NovaFlow', from: '10x faster', to: 'this week' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'clay-shots-')));
app.commandLine.appendSwitch('force-device-scale-factor', '2');

let win;
const js = (code) => win.webContents.executeJavaScript(code);

async function ready() {
  await js(`(async () => { await window.__clayReady; return true; })()`);
  await sleep(400);
}

// Hide transient chrome (toasts) so stills stay clean.
async function hideToast() {
  await js(`(() => {
    if (document.getElementById('__shots_css')) return;
    const s = document.createElement('style');
    s.id = '__shots_css';
    s.textContent = '#toast{display:none!important}';
    document.head.appendChild(s);
  })()`);
}

async function shot(name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
  console.log('saved', name, img.getSize().width + 'x' + img.getSize().height);
}

async function importSample(key, title) {
  await js(`new Promise((resolve, reject) => {
    window.__clay.runImport(window.CLAY_SAMPLES[${JSON.stringify(key)}], ${JSON.stringify(title)}, '', ${JSON.stringify(key)});
    const deadline = Date.now() + 8000;
    const check = () => {
      const ed = window.__clayEditor;
      if (ed && ed.getWrapper().components().length) return resolve(true);
      if (Date.now() < deadline) return setTimeout(check, 50);
      reject(new Error('editor did not initialize'));
    };
    check();
  })`);
  await sleep(1500);
  await js(`(() => {
    const doc = window.__clayEditor.Canvas.getDocument();
    const st = doc.createElement('style');
    st.textContent = '::-webkit-scrollbar{display:none!important}';
    doc.head.appendChild(st);
  })()`);
}

// Helpers installed into the page once per import.
async function installHelpers() {
  await js(`(() => {
    window.__shots = {
      comp(selector) {
        const ed = window.__clayEditor;
        const el = ed.Canvas.getDocument().querySelector(selector);
        if (!el) return null;
        let hit = null;
        const walk = (c) => { if (hit) return; if (c.getEl && c.getEl() === el) hit = c; else c.components().forEach(walk); };
        walk(ed.getWrapper());
        return hit;
      },
      canvasPoint(selector, fx = 0.5, fy = 0.5) {
        const ed = window.__clayEditor;
        const el = ed.Canvas.getDocument().querySelector(selector);
        const frame = ed.Canvas.getFrameEl();
        const f = frame.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const z = f.width / frame.contentWindow.innerWidth || 1;
        return { x: f.left + (r.left + r.width * fx) * z, y: f.top + (r.top + r.height * fy) * z };
      },
      uiPoint(selector, fx = 0.5, fy = 0.5) {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.left + r.width * fx, y: r.top + r.height * fy };
      },
    };
    return true;
  })()`);
}

async function select(selector) {
  return js(`(() => { const c = window.__shots.comp(${JSON.stringify(selector)}); if (!c) return 'missing'; window.__clayEditor.select(c); return 'ok'; })()`);
}

// ---------- fake cursor for the GIF ----------
let cursor = { x: 1180, y: 640 };
async function installCursor() {
  await js(`(() => {
    if (document.getElementById('__cursor')) return;
    document.body.insertAdjacentHTML('beforeend', \`
      <div id="__ripple" style="position:fixed;z-index:2147483646;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(139,108,255,.35);box-shadow:0 0 0 2px rgba(139,108,255,.6);pointer-events:none;opacity:0"></div>
      <div id="__cursor" style="position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">
        <svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 1.5v19.2l5-4.6 3.2 7.4 3.4-1.5-3.2-7.2h6.9z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </div>\`);
  })()`);
  await placeCursor(cursor);
}
async function placeCursor(p) {
  cursor = p;
  await js(`document.getElementById('__cursor').style.transform = 'translate(${p.x}px, ${p.y}px)'`);
}
async function ripple(on, p = cursor) {
  await js(`(() => { const r = document.getElementById('__ripple'); r.style.transform = 'translate(${p.x}px, ${p.y}px)'; r.style.opacity = ${on ? 1 : 0}; })()`);
}

// ---------- GIF frame recording ----------
let frameNo = 0;
async function frame(hold = 1) {
  const img = await win.webContents.capturePage();
  const buf = img.toPNG();
  for (let i = 0; i < hold; i++) {
    fs.writeFileSync(path.join(outDir, `f${String(frameNo++).padStart(4, '0')}.png`), buf);
  }
}
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
async function moveTo(p, steps = 10) {
  const from = { ...cursor };
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    await placeCursor({ x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t });
    await frame();
  }
}
async function clickAt(action) {
  await ripple(true);
  await frame(2);
  if (action) await action();
  await sleep(250);
  await ripple(false);
  await frame(2);
}

async function recordGif() {
  await importSample('tailwind', COPY.title);
  await hideToast();
  await installHelpers();
  await js(`void (window.__clayEditor.selectRemove(window.__clayEditor.getSelectedAll()))`);
  await sleep(300);
  await installCursor();
  await frame(10);

  // 1. Select the hero heading.
  const h1 = await js(`window.__shots.canvasPoint('h1', 0.3, 0.55)`);
  await moveTo(h1, 12);
  await clickAt(() => select('h1'));
  await frame(10);

  // 2. Retype the gradient phrase.
  const span = await js(`window.__shots.canvasPoint('h1 span', 0.5, 0.55)`);
  await moveTo(span, 6);
  await clickAt(() => select('h1 span'));
  await frame(4);
  // Animate keystrokes without recording each one, then commit the result as one edit (as a real retype is).
  await js(`void window.__clayEditor.UndoManager.stop()`);
  const from = COPY.from;
  for (let n = from.length; n >= 0; n -= 2) {
    await js(`void (window.__shots.comp('h1 span').components(${JSON.stringify(from.slice(0, n))}))`);
    await frame();
  }
  const to = COPY.to;
  for (let n = 1; n <= to.length; n++) {
    await js(`void (window.__shots.comp('h1 span').components(${JSON.stringify(to.slice(0, n))}))`);
    await frame();
  }
  await js(`void (window.__shots.comp('h1 span').components(${JSON.stringify(from)}))`);
  await js(`void window.__clayEditor.UndoManager.start()`);
  await js(`void (window.__shots.comp('h1 span').components(${JSON.stringify(to)}))`);
  await frame(10);

  // 3. Restyle the primary CTA.
  const cta = await js(`(() => {
    const doc = window.__clayEditor.Canvas.getDocument();
    const el = [...doc.querySelectorAll('a,button')].find((e) => /Start free trial/.test(e.textContent));
    el.setAttribute('data-shot-cta', '1');
    return window.__shots.canvasPoint('[data-shot-cta]', 0.5, 0.5);
  })()`);
  await moveTo(cta, 12);
  await clickAt(() => select('[data-shot-cta]'));
  await frame(6);
  const steps = ['#7c5cff', '#4f8bff', '#14b8a6', '#10b981'];
  await js(`void window.__clayEditor.UndoManager.stop()`);
  for (const c of steps) {
    if (c === steps[steps.length - 1]) await js(`void window.__clayEditor.UndoManager.start()`);
    await js(`void (window.__shots.comp('[data-shot-cta]').addStyle({ 'background-image': 'none', 'background-color': '${c}' }))`);
    await frame(2);
  }
  await frame(10);

  // 4. Responsive check.
  for (const device of ['tablet', 'mobile', 'desktop']) {
    const p = await js(`window.__shots.uiPoint('#device-seg [data-device="${device}"]')`);
    await moveTo(p, 10);
    await clickAt(() => js(`document.querySelector('#device-seg [data-device="${device}"]').click()`));
    await sleep(700);
    await frame(device === 'desktop' ? 4 : 14);
  }

  // 5. Readable history.
  const hist = await js(`window.__shots.uiPoint('#sidebar-tabs [data-tab="history"]')`);
  await moveTo(hist, 12);
  await clickAt(() => js(`document.querySelector('#sidebar-tabs [data-tab="history"]').click()`));
  await sleep(600);
  await frame(26);
  console.log('frames', frameNo);
}

async function recordStills() {
  await hideToast();
  await shot('home');

  await importSample('tailwind', COPY.title);
  await hideToast();
  await installHelpers();
  await select('h1');
  await sleep(500);
  await shot('editor');

  // Make a few real edits so History has content.
  await js(`void (window.__shots.comp('h1 span').components(${JSON.stringify(COPY.to)}))`);
  await sleep(200);
  await js(`(() => {
    const doc = window.__clayEditor.Canvas.getDocument();
    const el = [...doc.querySelectorAll('a,button')].find((e) => /Start free trial/.test(e.textContent));
    el.setAttribute('data-shot-cta', '1');
  })()`);
  await select('[data-shot-cta]');
  await js(`void (window.__shots.comp('[data-shot-cta]').addStyle({ 'background-image': 'none', 'background-color': '#10b981' }))`);
  await sleep(200);
  await js(`void (window.__shots.comp('[data-shot-cta]').addStyle({ 'border-radius': '12px' }))`);
  await sleep(400);

  await js(`void (window.__clayEditor.selectRemove(window.__clayEditor.getSelectedAll()))`);
  const rects = {};
  const frameRect = () => js(`(() => { const r = window.__clayEditor.Canvas.getFrameEl().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  await sleep(700);
  await shot('desktop');
  rects.desktop = await frameRect();
  for (const device of ['tablet', 'mobile']) {
    await js(`document.querySelector('#device-seg [data-device="${device}"]').click()`);
    await sleep(900);
    await shot(device);
    rects[device] = await frameRect();
  }
  fs.writeFileSync(path.join(outDir, 'rects.json'), JSON.stringify(rects, null, 2));
  await js(`document.querySelector('#device-seg [data-device="desktop"]').click()`);
  await sleep(700);
  await select('h1');
  await js(`document.querySelector('#sidebar-tabs [data-tab="layers"]').click()`);
  await sleep(500);
  await shot('layers');
  await js(`document.querySelector('#sidebar-tabs [data-tab="history"]').click()`);
  await sleep(600);
  await shot('history');
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false, backgroundColor: '#0b0b0d',
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
  });
  try {
    await win.loadFile(path.join(APP_DIR, 'renderer', 'index.html'));
    await js(`localStorage.setItem('clay-locale', ${JSON.stringify(locale)}); localStorage.setItem('clay-theme', 'dark');`);
    await win.reload();
    await ready();
    if (mode === 'gif') await recordGif();
    else await recordStills();
  } catch (e) {
    console.error('FAILED', (e && e.stack) || e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
