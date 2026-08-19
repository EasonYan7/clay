const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

/* 测试隔离口子:自动化验证必须指到临时目录,绝不允许碰用户的真实工作区。
 * (改 HOME 环境变量在 macOS 上骗不过 Electron —— userData 不走 HOME,吃过亏。) */
if (process.env.CLAY_USERDATA) app.setPath('userData', process.env.CLAY_USERDATA);

let win = null;
let closeApproved = false;
let closeRequestPending = false;

/* 当前编辑文件的外部变更监听。
 *
 * 监听父目录而不是文件本身:多数 AI/编辑器保存时会先写临时文件再 rename 覆盖原文件,
 * 直接 fs.watch(file) 会在第一次 rename 后失效。目录监听可以跨过删除/重建,并继续等它回来。
 * 主进程只保留当前页面的一路监听;渲染进程切页面/回主页时会同步切换或关闭。 */
let sourceWatch = null;

function contentDigest(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function stopSourceWatch(senderId) {
  if (!sourceWatch || (senderId !== undefined && sourceWatch.sender.id !== senderId)) return;
  const old = sourceWatch;
  sourceWatch = null;
  if (old.timer) clearTimeout(old.timer);
  try { old.watcher.close(); } catch (e) { /* 已关闭 */ }
}

function sendSourceChange(watch, payload) {
  if (sourceWatch !== watch || watch.sender.isDestroyed()) return;
  watch.sender.send('clay:source-changed', Object.assign({ path: watch.filePath }, payload));
}

function readWatchedSource(watch) {
  if (sourceWatch !== watch) return;
  watch.timer = null;
  try {
    const content = fs.readFileSync(watch.filePath, 'utf8');
    const digest = contentDigest(content);
    watch.retrying = false;
    if (digest === watch.digest) return;   // chmod/重复 rename 等元数据噪音
    watch.digest = digest;
    watch.missing = false;
    sendSourceChange(watch, { exists: true, content });
  } catch (err) {
    // 文件被原子替换时可能有极短的“不存在”窗口,再等一拍再判定真正丢失。
    if (!watch.retrying) {
      watch.retrying = true;
      watch.timer = setTimeout(() => readWatchedSource(watch), 220);
      return;
    }
    watch.retrying = false;
    if (!watch.missing) {
      watch.missing = true;
      watch.digest = null;
      sendSourceChange(watch, { exists: false });
    }
  }
}

function scheduleWatchedSourceRead(watch) {
  if (sourceWatch !== watch) return;
  if (watch.timer) clearTimeout(watch.timer);
  watch.retrying = false;
  watch.timer = setTimeout(() => readWatchedSource(watch), 180);
}

function refreshInternalWatch(filePath, content) {
  if (!sourceWatch || path.resolve(filePath) !== sourceWatch.filePath) return;
  // Clay 自己的写入在同一个事件循环里同步完成;先更新基线,随后到达的 fs.watch
  // 通知只会读到同一摘要并被过滤。若外部工具紧接着又写了不同内容,摘要不同仍会通知。
  sourceWatch.digest = contentDigest(content);
  sourceWatch.missing = false;
  sourceWatch.retrying = false;
  if (sourceWatch.timer) {
    clearTimeout(sourceWatch.timer);
    sourceWatch.timer = null;
  }
}

function createWindow() {
  closeApproved = false;
  closeRequestPending = false;
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: 'Clay',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#14141f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (event) => {
    if (closeApproved) return;
    if (win.webContents.isDestroyed()) {
      closeApproved = true;
      return;
    }
    event.preventDefault();
    if (closeRequestPending) return;
    closeRequestPending = true;
    win.webContents.send('clay:request-close');
  });
  win.on('closed', () => {
    stopSourceWatch();
    closeRequestPending = false;
    win = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Clay',
      submenu: [
        { role: 'about', label: '关于 Clay' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Clay' },
        { role: 'quit', label: '退出 Clay' },
      ],
    },
    {
      label: '文件',
      submenu: [
        {
          label: '打开 HTML 文件…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win && win.webContents.send('clay-menu', 'open'),
        },
        {
          label: '粘贴代码导入…',
          accelerator: 'Shift+CmdOrCtrl+V',
          click: () => win && win.webContents.send('clay-menu', 'paste'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => win && win.webContents.send('clay-menu', 'save'),
        },
        {
          label: '另存为…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => win && win.webContents.send('clay-menu', 'save-as'),
        },
        {
          label: '导出 PDF…',
          accelerator: 'CmdOrCtrl+P',
          click: () => win && win.webContents.send('clay-menu', 'export-pdf'),
        },
        { type: 'separator' },
        {
          label: '复制整页代码(给开发)',
          accelerator: 'CmdOrCtrl+E',
          click: () => win && win.webContents.send('clay-menu', 'copy-code'),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* 另存为:sourcePath 是导入时的原文件。
 * 默认存到它旁边、改个名,并且真要覆盖原文件时必须二次确认 ——
 * 用户的原稿不能被 Clay 无声改掉。 */
ipcMain.handle('clay:save-file', async (_e, defaultName, content, sourcePath) => {
  const startDir = sourcePath ? path.dirname(sourcePath) : app.getPath('documents');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '另存为',
    defaultPath: path.join(startDir, defaultName),
    filters: [{ name: 'HTML 页面', extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;

  if (sourcePath && path.resolve(filePath) === path.resolve(sourcePath)) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['取消', '覆盖原文件'],
      defaultId: 0,
      cancelId: 0,
      message: '这会覆盖你导入的原文件',
      detail: path.basename(sourcePath) + '\n\n原文件会被 Clay 导出的版本替换,无法撤销。',
    });
    if (response !== 1) return null;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  refreshInternalWatch(filePath, content);
  return filePath;
});

/* 保存(⌘S):直接写回源文件,Word 语义。
 * 不弹框 —— 弹框的那条路是另存为。走到这里说明用户明确要"存回原处"。
 * 同样先写临时文件再 rename,存到一半崩溃不能把用户的源文件毁成半截。 */
ipcMain.handle('clay:write-file', async (_e, filePath, content) => {
  try {
    const tmp = filePath + '.claytmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
    refreshInternalWatch(filePath, content);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 把绝对 <base> 插到 <head> 最前面,让临时 PDF 页面按原文件的位置解析。
// 原件若自带 <base href="../assets/">,必须先相对源文件求成绝对地址;仅仅指回源目录
// 会让浏览器原件、Clay 画布、PDF 三边加载到不同资源。
function injectBaseTag(html, sourcePath) {
  const sourceUrl = pathToFileURL(sourcePath).href;
  const dirUrl = pathToFileURL(path.dirname(sourcePath) + path.sep).href;
  const match = html.match(/<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const raw = match ? (match[1] || match[2] || match[3] || '') : '';
  let href = dirUrl;
  if (raw) {
    const decoded = raw.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
    try { href = new URL(decoded, sourceUrl).href; } catch (e) { href = dirUrl; }
  }
  const escaped = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return html.replace(/<head(\s[^>]*)?>/i, (m) => m + '<base data-clay-render-base href="' + escaped + '">');
}

/* 导出 PDF —— 追求"最忠实展示"的整页长图,像素级还原用户在屏幕上看到的样子。
 *
 * 为什么不用 printToPDF 直出:实测有两个坑,都会毁掉展示效果——
 *  1) 传一个和内容等大的巨型 pageSize 对象,Chromium 渲染出"只有背景、没有内容"的空白页;
 *  2) 打印布局里 @page 高度会成为新的 100vh 基准,页面里 min-height:100vh 的区块(hero/CTA)
 *     被撑高,内容反过来溢出到第二页 —— 而且越加高越溢出,永远收敛不了。
 * 所以改成:CDP 全页截图(captureBeyondViewport,用的是屏幕布局,不受打印重排影响)
 * → 把整页图片包成一张等大的单页 PDF。代价是文字不可选,但对"发给人看"的展示场景
 * 反而是像素级忠实;需要可选文字/交接开发的走"复制整页代码"。 */
ipcMain.handle('clay:export-pdf', async (_e, defaultName, html, width, height, sourcePath) => {
  // 渲染宽度跟着渲染进程里"当前选中的视图"走(桌面/平板/手机),不再固定死;
  // 传值异常(没传、非数)时退回旧的桌面默认宽度,兜底不出错。
  const shotWidth = Number.isFinite(width) && width > 0 ? Math.round(Math.min(width, 4000)) : 1280;
  const shotHeight = Number.isFinite(height) && height > 0 ? Math.round(Math.min(height, 4000)) : 900;
  let filePath;
  if (process.env.CLAY_PDF_OUT) {
    // 测试接缝(同 CLAY_USERDATA 思路):跳过原生对话框,直接写到指定路径。env 不设时零影响。
    filePath = process.env.CLAY_PDF_OUT;
  } else {
    const res = await dialog.showSaveDialog(win, {
      title: '导出 PDF',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    filePath = res.filePath;
  }

  let shotWin = null;
  let wrapWin = null;
  let tmpHtml = '';
  let tmpWrap = '';
  try {
    shotWin = new BrowserWindow({
      show: false,
      width: shotWidth,
      height: shotHeight,
      useContentSize: true,
      webPreferences: { javascript: true, contextIsolation: true, nodeIntegration: false },
    });
    /* 相对路径的图片/素材(AI 工具常见的"HTML + 图片文件夹"组合):这份 HTML 被写到
     * 系统临时目录去渲染截图,和原文件根本不在同一个文件夹,相对路径全部解析错位、
     * 图会裂 —— 跟画布编辑时踩过的是同一类问题(见 renderer/app.js 的 applyCanvasBase),
     * 这里同样插一个指回源文件目录的 <base>,只影响这次内部渲染,不进最终 PDF 内容。 */
    const htmlToRender = sourcePath ? injectBaseTag(html, sourcePath) : html;
    tmpHtml = path.join(app.getPath('temp'), 'clay-pdf-' + Date.now() + '.html');
    fs.writeFileSync(tmpHtml, htmlToRender, 'utf8');
    await shotWin.loadFile(tmpHtml);

    // 先滚一遍触发滚动渐显(opacity:0→显示),回顶;再暂停当前动画帧。
    // 不能通过改 CSS 来“稳定”页面:animation:none 会把元素重置到动画前,
    // fixed/sticky→static 更会直接改变文档流,这是此前 PDF 和 Clay 明显错位的根因。
    const dim = await shotWin.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const H = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.documentElement.offsetHeight);
      // 事件驱动地等真正就绪,替代旧的固定 setTimeout(400):慢机器/大图/未加载完的
      // Web 字体下,固定延时会截到"字体没换好、图还没出来"的中间态。
      try { await document.fonts.ready; } catch (e) { /* 不支持 fonts API 就跳过 */ }
      await Promise.all([...document.images].map((img) => {
        if (img.complete) return null;
        if (img.decode) return img.decode().catch(() => {});   // decode 比 onload 更接近"能画出来"
        return new Promise((res) => { img.onload = img.onerror = res; });
      }));
      for (let y = 0; y <= H(); y += Math.max(240, innerHeight * 0.8)) { scrollTo(0, y); await sleep(50); }
      scrollTo(0, 0);
      await sleep(250); // 让滚动触发的短过渡落到终态
      try { document.getAnimations().forEach((a) => a.pause()); } catch (e) { /* 老页面无此 API */ }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.documentElement.clientWidth), h: H() };
    })()`);

    const MAX_PX = 30000;   // 单页高度保护(PDF 单页约 200 英寸上限)
    const h = Math.min(Math.ceil(dim.h), MAX_PX);
    const w = Math.ceil(dim.w);

    // CDP 全页截图:不改窗口尺寸,captureBeyondViewport 抓完整页面(任意长度都能截)
    const dbg = shotWin.webContents.debugger;
    dbg.attach('1.3');
    const shot = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
    });
    dbg.detach();

    // 把整页图片包成一张等大的单页 PDF(纯 <img>,没有 vh 可重排,必是单页)
    wrapWin = new BrowserWindow({ show: false, width: w, height: Math.min(h, 900), useContentSize: true,
      webPreferences: { javascript: true } });
    const wrap = '<!doctype html><html><head><meta charset="utf-8"><style>'
      + '@page { size: ' + w + 'px ' + h + 'px; margin: 0; }'
      + '*{margin:0;padding:0} img{display:block;width:' + w + 'px;height:' + h + 'px}'
      + '</style></head><body><img src="data:image/png;base64,' + shot.data + '"></body></html>';
    tmpWrap = path.join(app.getPath('temp'), 'clay-pdf-wrap-' + Date.now() + '.html');
    fs.writeFileSync(tmpWrap, wrap, 'utf8');
    await wrapWin.loadFile(tmpWrap);
    // 等那张整页大图真正解码完再打印,替代固定 setTimeout(300):图未就绪时 printToPDF 会出空白页
    await wrapWin.webContents.executeJavaScript(`(async () => {
      const img = document.images[0];
      if (!img) return;
      if (!img.complete) await new Promise((res) => { img.onload = img.onerror = res; });
      if (img.decode) { try { await img.decode(); } catch (e) { /* 解码失败也继续,总比卡死好 */ } }
    })()`);

    const pdf = await wrapWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(filePath, pdf);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (shotWin) { try { shotWin.destroy(); } catch (e) { /* 已销毁 */ } }
    if (wrapWin) { try { wrapWin.destroy(); } catch (e) { /* 已销毁 */ } }
    if (tmpHtml) { try { fs.unlinkSync(tmpHtml); } catch (e) { /* 清理失败无所谓 */ } }
    if (tmpWrap) { try { fs.unlinkSync(tmpWrap); } catch (e) { /* 清理失败无所谓 */ } }
  }
});

ipcMain.handle('clay:confirm', async (_e, opts) => {
  if (process.env.CLAY_TEST_CONFIRM_RESPONSE !== undefined) {
    return Number(process.env.CLAY_TEST_CONFIRM_RESPONSE);
  }
  const { response } = await dialog.showMessageBox(win, {
    type: opts.type || 'question',
    buttons: opts.buttons,
    defaultId: opts.defaultId || 0,
    cancelId: opts.cancelId === undefined ? 0 : opts.cancelId,
    message: opts.message,
    detail: opts.detail || '',
  });
  return response;
});

ipcMain.on('clay:close-result', (event, shouldClose) => {
  if (!win || event.sender !== win.webContents || !closeRequestPending) return;
  closeRequestPending = false;
  if (!shouldClose) return;
  closeApproved = true;
  win.close();
});

// 只有隔离用户数据的打包回归才开启:从主进程发起和红灯/⌘Q 同路的关窗。
if (process.env.CLAY_TEST_CLOSE) {
  ipcMain.on('clay:test-close-window', (event) => {
    if (win && event.sender === win.webContents) win.close();
  });
}

/* 最近文件用:过滤出仍然存在的路径(删除/移动的会被剔除,主页据此不显示) */
ipcMain.handle('clay:filter-existing', async (_e, paths) => {
  if (!Array.isArray(paths)) return [];
  return paths.filter((p) => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch (e) { return false; }
  });
});

/* 按路径直接读取(从"最近编辑"点开一个文件用,不弹对话框) */
ipcMain.handle('clay:read-path', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return { name: path.basename(filePath), path: filePath, content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return null;
  }
});

/* 当前源文件监听。返回启动监听这一刻的内容,让“应用关闭期间文件已被 AI 改过”
 * 也能在用户重新点开标签页时立即被发现,而不是必须等下一次磁盘事件。 */
ipcMain.handle('clay:watch-source', async (e, filePath) => {
  stopSourceWatch();
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: '文件路径无效' };

  const target = path.resolve(filePath);
  const dir = path.dirname(target);
  try {
    const content = fs.readFileSync(target, 'utf8');
    const sender = e.sender;
    const watch = {
      sender,
      filePath: target,
      fileName: path.basename(target).normalize('NFC'),
      digest: contentDigest(content),
      missing: false,
      retrying: false,
      timer: null,
      watcher: null,
    };
    watch.watcher = fs.watch(dir, { persistent: false }, (_eventType, changedName) => {
      if (sourceWatch !== watch) return;
      if (changedName && String(changedName).normalize('NFC') !== watch.fileName) return;
      scheduleWatchedSourceRead(watch);
    });
    watch.watcher.on('error', (err) => {
      sendSourceChange(watch, { exists: null, error: String(err && err.message || err) });
      stopSourceWatch(sender.id);
    });
    sourceWatch = watch;
    return { ok: true, path: target, exists: true, content };
  } catch (err) {
    let exists = false;
    try { exists = fs.statSync(target).isFile(); } catch (e2) { /* 确实不存在/不可读 */ }
    // 区分“文件不存在”和“文件仍在但系统监听失败”,避免把权限/句柄问题误报成被删除。
    return { ok: false, path: target, exists, error: String(err && err.message || err) };
  }
});

ipcMain.handle('clay:unwatch-source', async (e) => {
  stopSourceWatch(e.sender.id);
  return { ok: true };
});

ipcMain.handle('clay:open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '打开 HTML 文件',
    filters: [{ name: 'HTML 页面', extensions: ['html', 'htm'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;
  return {
    name: path.basename(filePaths[0]),
    path: filePaths[0],
    content: fs.readFileSync(filePaths[0], 'utf8'),
  };
});

/* 工作区持久化 —— 写磁盘而非 localStorage。
 * localStorage 只有 5-10MB,嵌几张图就爆;这是桌面应用,本来就有文件系统。
 * 先写临时文件再 rename:写到一半崩溃也不会留下半截的损坏工作区。 */
function workspacePath() {
  return path.join(app.getPath('userData'), 'workspace.json');
}

/* 写入前的最后一道防线。
 * 曾经因为渲染层的竞态,用空 docs 覆盖掉了用户的存档且无法找回。
 * 这里再兜一层:(1) 拒绝用空存档盖掉有内容的存档;(2) 覆盖前留上一版。 */
function guardedWrite(json) {
  const p = workspacePath();
  const tmp = p + '.tmp';
  const bak = p + '.bak';

  let incomingEmpty = true;
  try { incomingEmpty = !(JSON.parse(json).docs || []).length; } catch (e) { return { ok: false, error: '数据格式错误' }; }

  if (incomingEmpty && fs.existsSync(p)) {
    try {
      const old = JSON.parse(fs.readFileSync(p, 'utf8'));
      if ((old.docs || []).length) {
        // 用户可能真的关掉了所有页面 —— 那也先把旧的留成 .bak 再写
        fs.copyFileSync(p, bak);
      }
    } catch (e) { /* 旧档读不动就不备份,继续写 */ }
  }

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(p) && !incomingEmpty) {
    try { fs.copyFileSync(p, bak); } catch (e) { /* 备份失败不该挡住正常保存 */ }
  }
  fs.renameSync(tmp, p);   // 原子替换:写一半崩了也不会留半截文件
  return { ok: true, bytes: Buffer.byteLength(json, 'utf8') };
}

ipcMain.handle('clay:save-workspace', async (_e, json) => {
  try {
    return guardedWrite(json);
  } catch (err) {
    try { const t = workspacePath() + '.tmp'; fs.existsSync(t) && fs.unlinkSync(t); } catch (e) { /* 清理失败无所谓 */ }
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.on('clay:save-workspace-sync', (e, json) => {
  try {
    e.returnValue = guardedWrite(json).ok;
  } catch (err) {
    e.returnValue = false;
  }
});

ipcMain.handle('clay:load-workspace', async () => {
  try {
    const p = workspacePath();
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    return null;
  }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
