// Composes framed README artwork from raw screenshots.
// Usage: see scripts/readme-assets/build.sh
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [rawDir, outDir, lang, mode = 'stills', framesDir, gifOut] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ICON = path.join(process.cwd(), 'build', 'icon.png');
app.commandLine.appendSwitch('force-device-scale-factor', '2');

const T = {
  en: {
    font: '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif',
    pill: 'Open source · macOS · Local-first',
    title: 'Finish what AI started.',
    sub: 'Open AI-generated HTML as a visual canvas.<br>Edit it directly — and keep the code you already have.',
  },
  zh: {
    font: '-apple-system, "PingFang SC", "SF Pro Display", sans-serif',
    pill: '开源 · macOS · 本地优先',
    title: 'AI 起稿，Clay 收尾。',
    sub: '把 AI 生成的 HTML 变成可编辑的画布。<br>所见即所得地修改，保留你原有的代码。',
  },
}[lang];

const url = (p) => 'file://' + encodeURI(p);
const SHOT_W = 1440;
const SHOT_H = 900;

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #09090b; }
  body { font-family: ${T.font}; -webkit-font-smoothing: antialiased; color: #fafafa; }
  .stage { position: relative; overflow: hidden; background:
      radial-gradient(900px 420px at 50% -6%, rgba(124, 92, 255, .30), transparent 70%),
      radial-gradient(700px 500px at 0% 110%, rgba(217, 70, 239, .10), transparent 70%),
      radial-gradient(700px 500px at 100% 110%, rgba(56, 189, 248, .07), transparent 70%),
      #09090b; }
  .grid { position: absolute; inset: 0; pointer-events: none;
      background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
      background-size: 40px 40px;
      -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, #000 20%, transparent 75%); }
  .win { position: relative; border-radius: 14px; overflow: hidden; background: #0b0b0d;
      box-shadow: 0 0 0 1px rgba(255,255,255,.10), 0 1px 0 0 rgba(255,255,255,.08) inset,
                  0 50px 120px -30px rgba(0,0,0,.9), 0 30px 60px -30px rgba(124,92,255,.25); }
  .win > img { display: block; width: 100%; }
  .lights { position: absolute; display: flex; }
  .lights i { display: block; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.25); }
  .lights i:nth-child(1) { background: #ff5f57; } .lights i:nth-child(2) { background: #febc2e; } .lights i:nth-child(3) { background: #28c840; }
`;

// A screenshot inside a macOS-style window, traffic lights placed where Clay reserves space for them.
function windowHtml(src, width) {
  const k = width / SHOT_W;
  const d = 12 * k, gap = 8 * k;
  return `<div class="win" style="width:${width}px">
    <img src="${url(src)}">
    <div class="lights" style="left:${18 * k}px; top:${(22 - 6) * k}px; gap:${gap}px">
      <i style="width:${d}px;height:${d}px"></i><i style="width:${d}px;height:${d}px"></i><i style="width:${d}px;height:${d}px"></i>
    </div>
  </div>`;
}

function framed(src, { stageW = 1600, pad = 80 } = {}) {
  const winW = stageW - pad * 2;
  const stageH = Math.round(winW * SHOT_H / SHOT_W + pad * 2);
  return { w: stageW, h: stageH, body: `<div class="stage" style="width:${stageW}px;height:${stageH}px;padding:${pad}px">
    <div class="grid"></div>${windowHtml(src, winW)}</div>` };
}

function hero(src) {
  const stageW = 1600, winW = 1360, top = 330, visibleH = 620;
  const stageH = top + visibleH;
  return { w: stageW, h: stageH, body: `
  <style>
    .hero-head { position: absolute; left: 0; right: 0; top: 64px; text-align: center; }
    .brand { display: inline-flex; align-items: center; gap: 14px; }
    .brand img { width: 52px; height: 52px; border-radius: 12px; box-shadow: 0 8px 30px rgba(124,92,255,.45); }
    .brand span { font-size: 34px; font-weight: 700; letter-spacing: -.02em; }
    .pill { display: inline-block; margin-left: 18px; padding: 6px 14px; border-radius: 999px; font-size: 14px; color: rgba(250,250,250,.7);
            background: rgba(255,255,255,.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,.10); vertical-align: middle; }
    h1 { margin-top: 28px; font-size: 64px; line-height: 1.05; font-weight: 700; letter-spacing: -.035em;
         background: linear-gradient(180deg, #fff 30%, rgba(255,255,255,.62)); -webkit-background-clip: text; color: transparent; }
    .sub { margin-top: 18px; font-size: 21px; line-height: 1.55; color: rgba(250,250,250,.58); }
    .hero-win { position: absolute; left: ${(stageW - winW) / 2}px; top: ${top + 30}px;
                -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent 100%); }
  </style>
  <div class="stage" style="width:${stageW}px;height:${stageH}px">
    <div class="grid"></div>
    <div class="hero-head">
      <div class="brand"><img src="${url(ICON)}"><span>Clay</span><em class="pill" style="font-style:normal">${T.pill}</em></div>
      <h1>${T.title}</h1>
      <p class="sub">${T.sub}</p>
    </div>
    <div class="hero-win">${windowHtml(src, winW)}</div>
  </div>` };
}

// Desktop, tablet and phone renderings of the same page, cropped from Clay's own device previews.
function devices(raw, rects) {
  const stageW = 1600, stageH = 900;
  const crop = (src, r, dispW, maxH) => {
    const k = dispW / r.w;
    const h = Math.min(r.h, maxH / k);
    return `<div style="width:${dispW}px;height:${h * k}px;overflow:hidden;position:relative">
      <img src="${url(src)}" style="position:absolute;width:${SHOT_W * k}px;left:${-r.x * k}px;top:${-r.y * k}px"></div>`;
  };
  const r = rects;
  return { w: stageW, h: stageH, body: `
  <style>
    .dev { position: absolute; border-radius: 18px; overflow: hidden; background: #000;
           box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 0 0 7px #151518, 0 0 0 8px rgba(255,255,255,.08), 0 40px 90px -20px rgba(0,0,0,.9); }
    .phone { border-radius: 34px; }
    .label { position: absolute; font-size: 15px; letter-spacing: .02em; color: rgba(250,250,250,.5); }
  </style>
  <div class="stage" style="width:${stageW}px;height:${stageH}px">
    <div class="grid"></div>
    <div class="dev" style="left:80px;top:110px">${crop(path.join(raw, 'desktop.png'), r.desktop, 980, 600)}</div>
    <div class="dev" style="left:900px;top:350px">${crop(path.join(raw, 'tablet.png'), r.tablet, 470, 420)}</div>
    <div class="dev phone" style="left:1250px;top:260px">${crop(path.join(raw, 'mobile.png'), r.mobile, 270, 540)}</div>
  </div>` };
}

let win;
async function render({ w, h, body }, file) {
  const htmlFile = path.join(outDir, '.compose.html');
  fs.writeFileSync(htmlFile, `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style>${body}`);
  win.setContentSize(w, h);
  await win.loadFile(htmlFile);
  await win.webContents.executeJavaScript(`Promise.all([...document.images].map(i => i.decode())).then(() => document.fonts.ready).then(() => true)`);
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  fs.writeFileSync(file, img.toPNG());
  return img.getSize();
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false, backgroundColor: '#09090b',
    webPreferences: { sandbox: false, webSecurity: false } });
  try {
    if (mode === 'gif') {
      fs.mkdirSync(gifOut, { recursive: true });
      const files = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
      for (const f of files) await render(framed(path.join(framesDir, f), { stageW: 1200, pad: 44 }), path.join(gifOut, f));
      console.log('composed frames', files.length);
    } else {
      const rects = JSON.parse(fs.readFileSync(path.join(rawDir, 'rects.json'), 'utf8'));
      const jobs = {
        hero: hero(path.join(rawDir, 'editor.png')),
        editor: framed(path.join(rawDir, 'editor.png')),
        responsive: devices(rawDir, rects),
        history: framed(path.join(rawDir, 'history.png')),
        home: framed(path.join(rawDir, 'home.png')),
      };
      for (const [name, job] of Object.entries(jobs)) {
        const s = await render(job, path.join(outDir, `${name}-${lang}.png`));
        console.log('composed', name, s.width + 'x' + s.height);
      }
    }
    fs.rmSync(path.join(outDir, '.compose.html'), { force: true });
  } catch (e) {
    console.error('FAILED', (e && e.stack) || e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
