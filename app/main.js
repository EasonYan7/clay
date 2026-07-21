const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

/* 测试隔离口子:自动化验证必须指到临时目录,绝不允许碰用户的真实工作区。
 * (改 HOME 环境变量在 macOS 上骗不过 Electron —— userData 不走 HOME,吃过亏。) */
if (process.env.CLAY_USERDATA) app.setPath('userData', process.env.CLAY_USERDATA);

let win = null;

function createWindow() {
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
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 把 <base href="file://原目录/"> 插到 <head> 最前面,让相对路径按原文件的位置解析
// (逻辑和 renderer/app.js 的 applyCanvasBase 对齐:每段路径单独编码,斜杠保留)
function injectBaseTag(html, sourcePath) {
  const dir = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
  const href = 'file://' + dir.split('/').map(encodeURIComponent).join('/');
  return html.replace(/<head(\s[^>]*)?>/i, (m) => m + '<base href="' + href + '">');
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
ipcMain.handle('clay:export-pdf', async (_e, defaultName, html, width, sourcePath) => {
  // 渲染宽度跟着渲染进程里"当前选中的视图"走(桌面/平板/手机),不再固定死;
  // 传值异常(没传、非数)时退回旧的桌面默认宽度,兜底不出错。
  const shotWidth = Number.isFinite(width) && width > 0 ? Math.round(Math.min(width, 4000)) : 1280;
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
      height: 900,
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
    await new Promise((r) => setTimeout(r, 400));

    // 先滚一遍触发滚动渐显(opacity:0→显示),回顶;再关掉动画/过渡,避免截到中间态残影
    const dim = await shotWin.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const H = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.documentElement.offsetHeight);
      for (let y = 0; y <= H(); y += Math.max(240, innerHeight * 0.8)) { scrollTo(0, y); await sleep(50); }
      scrollTo(0, 0);
      const s = document.createElement('style');
      // 全页截图对 backdrop-filter(毛玻璃)有合成 bug:粘性导航的毛玻璃会采样到页面
      // 别处(常是底部页脚)的内容,在顶部糊出一层文字残影。快照里导航背后本就没有可透视
      // 的内容,去掉毛玻璃视觉无差别却能根治残影。顺带关掉动画/过渡,避免截到中间态。
      s.textContent = '*,*::before,*::after { animation: none !important; transition: none !important;'
        + ' backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
      document.head.appendChild(s);
      // sticky/fixed 也一并降成 static:快照没有滚动,固定定位只会造成重叠错位
      document.querySelectorAll('*').forEach((el) => {
        const p = getComputedStyle(el).position;
        if (p === 'sticky' || p === 'fixed') el.style.position = 'static';
      });
      await sleep(200);
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
    wrapWin = new BrowserWindow({ show: false, width: w, height: Math.min(h, 900), webPreferences: { javascript: true } });
    const wrap = '<!doctype html><html><head><meta charset="utf-8"><style>'
      + '@page { size: ' + w + 'px ' + h + 'px; margin: 0; }'
      + '*{margin:0;padding:0} img{display:block;width:' + w + 'px;height:' + h + 'px}'
      + '</style></head><body><img src="data:image/png;base64,' + shot.data + '"></body></html>';
    tmpWrap = path.join(app.getPath('temp'), 'clay-pdf-wrap-' + Date.now() + '.html');
    fs.writeFileSync(tmpWrap, wrap, 'utf8');
    await wrapWin.loadFile(tmpWrap);
    await new Promise((r) => setTimeout(r, 300));

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
