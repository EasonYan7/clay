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
let currentLocale = 'zh-CN';

const RENDERER_INDEX_PATH = path.join(__dirname, 'renderer', 'index.html');
const RENDERER_INDEX_URL = pathToFileURL(RENDERER_INDEX_PATH).href;

const MAIN_MESSAGES = {
  'zh-CN': {
    about: '关于 Clay', hide: '隐藏 Clay', quit: '退出 Clay', file: '文件', open: '打开 HTML 文件…',
    paste: '粘贴代码导入…', save: '保存', saveAs: '另存为…', exportPdf: '导出 PDF…',
    copyCode: '复制整页代码（给开发）', edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切',
    copy: '复制', pasteEdit: '粘贴', selectAll: '全选', view: '视图', reload: '重新加载',
    fullscreen: '全屏', devtools: '开发者工具', window: '窗口', minimize: '最小化', close: '关闭窗口',
    htmlPage: 'HTML 页面', cancel: '取消', overwrite: '覆盖原文件', overwriteMessage: '这会覆盖你导入的原文件',
    overwriteDetail: '原文件会被 Clay 导出的版本替换，无法撤销。', pdfFile: 'PDF 文件', invalidPath: '文件路径无效', invalidData: '数据格式错误',
    pdfTooTall: '页面高度超过单页 PDF 的 30000 像素上限，请缩短页面后重试',
    pdfTooWide: '页面宽度超过单页 PDF 的 4000 像素上限，请缩窄页面后重试',
    pdfSurfaceTooLarge: '页面在屏幕缩放后的实际渲染表面超过安全上限（60000000 像素），请缩小页面后重试',
    pdfReadyTimeout: '等待页面字体或图片加载超时', pdfSnapshotFailed: 'PDF 页面渲染失败',
  },
  'en-US': {
    about: 'About Clay', hide: 'Hide Clay', quit: 'Quit Clay', file: 'File', open: 'Open HTML File…',
    paste: 'Import Pasted Code…', save: 'Save', saveAs: 'Save As…', exportPdf: 'Export PDF…',
    copyCode: 'Copy Full Page Code', edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy',
    pasteEdit: 'Paste', selectAll: 'Select All', view: 'View', reload: 'Reload', fullscreen: 'Toggle Full Screen',
    devtools: 'Developer Tools', window: 'Window', minimize: 'Minimize', close: 'Close Window',
    htmlPage: 'HTML Page', cancel: 'Cancel', overwrite: 'Overwrite Original', overwriteMessage: 'This will overwrite the imported source file',
    overwriteDetail: 'Clay will replace the original file with the exported version. This cannot be undone.',
    pdfFile: 'PDF File', invalidPath: 'Invalid file path', invalidData: 'Invalid data format',
    pdfTooTall: 'The page is taller than the 30000px single-page PDF limit. Shorten it and try again.',
    pdfTooWide: 'The page is wider than the 4000px single-page PDF limit. Narrow it and try again.',
    pdfSurfaceTooLarge: 'The device-scaled PDF rendering surface exceeds the safe 60000000-pixel limit. Reduce the page and try again.',
    pdfReadyTimeout: 'Timed out while waiting for page fonts or images', pdfSnapshotFailed: 'PDF page rendering failed',
  },
};

const PDF_MAX_HEIGHT = 30000;
const PDF_MAX_WIDTH = 4000;
const PDF_MAX_SURFACE_DIMENSION = 30000;
const PDF_MAX_SURFACE_PIXELS = 60000000;
const PDF_READY_TIMEOUT_MS = 10000;
const PDF_SNAPSHOT_WORLD_ID = 1001;

function normalizeLocale(locale) {
  return String(locale || '').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}
function mt(key) {
  return MAIN_MESSAGES[currentLocale][key] || MAIN_MESSAGES['zh-CN'][key] || key;
}

/* 所有来自 renderer 的磁盘能力都必须来自主窗口的主 frame。
 * 不能只看 sender:同一个 WebContents 还可能承载被导入 HTML 创建的子 frame。
 * 子 frame 不应获得打开、读取、写入或导出本地文件的能力。 */
function isTrustedMainFrameEvent(event) {
  const sender = event && event.sender;
  if (!win || win.isDestroyed() || !sender || sender !== win.webContents || sender.isDestroyed()) return false;
  const frame = event.senderFrame;
  if (!frame || !sender.mainFrame || frame !== sender.mainFrame) return false;
  const senderUrl = sender.getURL();
  const frameUrl = frame.url || senderUrl;
  return senderUrl === RENDERER_INDEX_URL && frameUrl === RENDERER_INDEX_URL;
}

function isHtmlFilePath(filePath) {
  if (typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

/* 原生保存对话框只需要一个文件名,不能把中文/日文等合法 Unicode 字符替换掉。
 * 仅移除平台文件名禁止的字符、控制字符和末尾空格/点,并限制长度。 */
function sanitizeDefaultFileName(value, fallback) {
  const raw = String(value || '').normalize('NFC').replace(/\\/g, '/');
  const base = raw.split('/').pop() || '';
  const safe = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  return safe && safe !== '.' && safe !== '..' ? safe : fallback;
}

/* 统一的路径能力约束:
 * - 只接受绝对 HTML/HTM 路径,避免通过 IPC 读取任意系统文件;
 * - 每次调用都 lstat + realpath,文件本身是 symlink 时拒绝;
 * - write 允许源文件刚被外部删除后重建,但父目录必须仍是目录;
 * - capability 只以 canonical path 作为 key,不保留可被替换的 lexical key。 */
function resolveHtmlPath(filePath, { mustExist = false } = {}) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0') || !path.isAbsolute(filePath)) return null;
  const resolved = path.resolve(filePath);
  if (!isHtmlFilePath(resolved)) return null;
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const canonical = fs.realpathSync.native(resolved);
    const canonicalStat = fs.lstatSync(canonical);
    if (canonicalStat.isSymbolicLink() || !canonicalStat.isFile()) return null;
    return canonical;
  } catch (err) {
    if (mustExist || !err || err.code !== 'ENOENT') return null;
    try {
      const parent = path.dirname(resolved);
      if (!fs.statSync(parent).isDirectory()) return null;
      const canonicalParent = fs.realpathSync.native(parent);
      if (!fs.lstatSync(canonicalParent).isDirectory()) return null;
      return path.join(canonicalParent, path.basename(resolved));
    } catch (parentErr) {
      return null;
    }
  }
}

const fileCapabilities = new Map();

function grantFileCapability(filePath, { read = true, write = true, mustExist = false } = {}) {
  const safePath = resolveHtmlPath(filePath, { mustExist });
  if (!safePath) return null;
  const old = fileCapabilities.get(safePath) || { read: false, write: false };
  fileCapabilities.set(safePath, { read: old.read || read, write: old.write || write });
  return safePath;
}

function hasFileCapability(filePath, mode, { mustExist = false } = {}) {
  const safePath = resolveHtmlPath(filePath, { mustExist });
  if (!safePath) return null;
  const capability = fileCapabilities.get(safePath);
  return capability && capability[mode] ? safePath : null;
}

function seedWorkspaceCapabilities(workspace) {
  if (!workspace) return;
  const paths = [];
  workspace.recents.forEach((recent) => paths.push(recent.path));
  workspace.docs.forEach((doc) => { if (doc.sourcePath) paths.push(doc.sourcePath); });
  paths.forEach((candidate) => {
    // 启动恢复只接受 HTML 路径;文件不存在时仍保留写回能力,以支持“重建源文件”。
    grantFileCapability(candidate, { read: true, write: true });
  });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/* 工作区 schema 是有意保持轻量的:docs 内含 GrapesJS 工程数据,不能深度限制未知字段;
 * 但顶层和数组元素必须足够完整,这样 renderer 永远不会收到 JSON 语法正确却结构危险的数据。 */
function validateWorkspace(value) {
  if (!isPlainRecord(value) || !Array.isArray(value.docs)) return null;
  if (value.docs.some((doc) => !isPlainRecord(doc))) return null;
  const recents = value.recents === undefined ? [] : value.recents;
  if (!Array.isArray(recents) || recents.some((recent) => !isPlainRecord(recent)
    || typeof recent.path !== 'string' || !recent.path
    || (recent.name !== undefined && typeof recent.name !== 'string'))) return null;
  if (value.activeDocId !== undefined && value.activeDocId !== null && typeof value.activeDocId !== 'string') return null;
  if (value.docSeq !== undefined && (!Number.isInteger(value.docSeq) || value.docSeq < 0)) return null;
  if (value.sessionOpen !== undefined && typeof value.sessionOpen !== 'boolean') return null;
  return value.recents === undefined ? Object.assign({}, value, { recents }) : value;
}

function parseWorkspace(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return validateWorkspace(JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

function inspectWorkspaceFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return { status: 'corrupt' };
    const raw = fs.readFileSync(filePath, 'utf8');
    const value = parseWorkspace(raw);
    return value ? { status: 'valid', raw, value } : { status: 'corrupt' };
  } catch (err) {
    return err && err.code === 'ENOENT' ? { status: 'missing' } : { status: 'corrupt' };
  }
}

function readValidWorkspace(filePath) {
  const result = inspectWorkspaceFile(filePath);
  return result.status === 'valid' ? result : null;
}

function preserveCorruptWorkspaceFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('workspace corrupt file is not a regular file');
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = Date.now() + '-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    const copyPath = path.join(dir, base + '.corrupt-' + suffix);
    try {
      fs.copyFileSync(filePath, copyPath, fs.constants.COPYFILE_EXCL);
      return copyPath;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('could not preserve corrupt workspace file');
}

function stripExecutableMarkup(html) {
  const source = String(html || '');
  // PDF 只需要页面展示,任何作者脚本都不应在隐藏窗口中恢复执行。
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
    .replace(/\s+(?:href|src)\s*=\s*javascript:[^\s>]+/gi, '');
}

function makePdfSnapshotHtml(html, sourcePath) {
  let snapshot = stripExecutableMarkup(html);
  if (sourcePath) snapshot = injectBaseTag(snapshot, sourcePath);
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
    + 'base-uri file: data: http: https:; style-src \'unsafe-inline\' file: data: http: https:; '
    + 'img-src file: data: blob: http: https:; font-src file: data: blob: http: https:; '
    + 'media-src file: data: blob: http: https:; connect-src \'none\'; '
    + 'object-src \'none\'; frame-src \'none\'; child-src \'none\'; worker-src \'none\'; '
    + 'script-src \'none\'; form-action \'none\'; manifest-src \'none\'">';
  if (/<head(?:\s[^>]*)?>/i.test(snapshot)) {
    return snapshot.replace(/<head(\s[^>]*)?>/i, (match) => match + csp);
  }
  return '<!doctype html><html><head>' + csp + '</head><body>' + snapshot + '</body></html>';
}

/* BrowserWindow 维持 javascript:false,所以页面脚本永远不会执行；主进程需要的
 * 尺寸和资源就绪探针放到隔离 world 中运行。Electron 的普通 executeJavaScript
 * 会尊重页面的 javascript:false 而拒绝执行,executeJavaScriptInIsolatedWorld
 * 则只提供受控的测量能力。 */
function executePdfProbe(webContents, code) {
  if (typeof webContents.executeJavaScriptInIsolatedWorld === 'function') {
    return webContents.executeJavaScriptInIsolatedWorld(PDF_SNAPSHOT_WORLD_ID, [{ code }]);
  }
  return webContents.executeJavaScript(code);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePdfTempPath(prefix) {
  return path.join(
    app.getPath('temp'),
    prefix + '-' + process.pid + '-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex') + '.html',
  );
}

async function waitForPdfReadiness(webContents) {
  const deadline = Date.now() + PDF_READY_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const state = await executePdfProbe(webContents,
        `(async () => {
          const images = await Promise.all([...document.images].map(async (img) => {
            const hasResource = Boolean((img.getAttribute('src') || img.getAttribute('srcset') || '').trim());
            if (!hasResource) return { hasResource: false, complete: true, naturalWidth: 0, naturalHeight: 0, decoded: true };
            const complete = img.complete;
            const naturalWidth = img.naturalWidth;
            const naturalHeight = img.naturalHeight;
            let decoded = complete && naturalWidth > 0 && naturalHeight > 0;
            if (decoded && typeof img.decode === 'function') {
              try {
                decoded = await Promise.race([
                  img.decode().then(() => true, () => false),
                  new Promise((resolve) => setTimeout(() => resolve(false), 500)),
                ]);
              } catch (e) {
                decoded = false;
              }
            }
            return { hasResource: true, complete, naturalWidth, naturalHeight, decoded };
          }));
          return { fonts: document.fonts ? document.fonts.status : 'loaded', images };
        })()`);
      if (state && state.fonts === 'loaded' && state.images.every((image) => !image.hasResource
        || (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && image.decoded))) return state;
    } catch (err) {
      lastError = err;
    }
    await delay(50);
  }
  const detail = lastError && lastError.message ? ': ' + lastError.message : '';
  throw new Error(mt('pdfReadyTimeout') + detail);
}

async function readPdfDimensions(webContents) {
  return executePdfProbe(webContents,
    `({ w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.documentElement.clientWidth),
        h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.documentElement.offsetHeight),
        dpr: Number(window.devicePixelRatio) || 1 })`);
}

function validatePdfDimensions(dim) {
  const w = Math.ceil(Number(dim && dim.w));
  const h = Math.ceil(Number(dim && dim.h));
  const dpr = Number(dim && dim.dpr);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0
    || !Number.isFinite(dpr) || dpr <= 0) {
    throw new Error(mt('pdfSnapshotFailed') + ': invalid page dimensions');
  }
  const surfaceWidth = Math.ceil(w * dpr);
  const surfaceHeight = Math.ceil(h * dpr);
  return { w, h, dpr, surfaceWidth, surfaceHeight };
}

function ensurePdfSurfaceWithinLimit(dim) {
  if (dim.surfaceWidth > PDF_MAX_SURFACE_DIMENSION || dim.surfaceHeight > PDF_MAX_SURFACE_DIMENSION
    || dim.surfaceWidth * dim.surfaceHeight > PDF_MAX_SURFACE_PIXELS) {
    throw new Error(mt('pdfSurfaceTooLarge'));
  }
}

/* 当前编辑文件的外部变更监听。
 *
 * 监听父目录而不是文件本身:多数 AI/编辑器保存时会先写临时文件再 rename 覆盖原文件,
 * 直接 fs.watch(file) 会在第一次 rename 后失效。目录监听可以跨过删除/重建,并继续等它回来。
 * 主进程只保留当前页面的一路监听;渲染进程切页面/回主页时会同步切换或关闭。 */
let sourceWatch = null;
let previousSourceWatchForTest = null;

function contentDigest(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function stopSourceWatch(senderId) {
  if (!sourceWatch || (senderId !== undefined && sourceWatch.sender.id !== senderId)) return;
  const old = sourceWatch;
  sourceWatch = null;
  if (process.env.CLAY_TEST_CLOSE) previousSourceWatchForTest = old;
  if (old.timer) clearTimeout(old.timer);
  try { old.watcher.close(); } catch (e) { /* 已关闭 */ }
}

function stopSourceWatchInstance(watch) {
  if (sourceWatch !== watch) return;
  stopSourceWatch();
}

function sendSourceChange(watch, payload) {
  if (sourceWatch !== watch || watch.sender.isDestroyed()) return;
  watch.sender.send('clay:source-changed', Object.assign({ path: watch.filePath }, payload));
}

function unsafeWatchPathError(message) {
  const err = new Error(message);
  err.code = 'CLAY_UNSAFE_WATCH_PATH';
  return err;
}

/* A capability is granted for one canonical regular file. Re-check that
 * invariant for every watch read: the pathname may have been replaced after
 * watch-source returned. O_NOFOLLOW closes the final-component TOCTOU window
 * where available; the post-open inode/canonical checks cover atomic swaps and
 * platforms without that flag before any bytes are read. */
function readCanonicalWatchedFile(filePath) {
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw unsafeWatchPathError('watched source is no longer a regular file');
  }
  const canonicalBefore = fs.realpathSync.native(filePath);
  if (canonicalBefore !== filePath) {
    throw unsafeWatchPathError('watched source canonical path changed');
  }

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let fd = null;
  try {
    fd = fs.openSync(filePath, flags);
    const opened = fs.fstatSync(fd);
    const after = fs.lstatSync(filePath);
    const canonicalAfter = fs.realpathSync.native(filePath);
    if (!opened.isFile() || after.isSymbolicLink() || !after.isFile()
      || canonicalAfter !== filePath || opened.dev !== after.dev || opened.ino !== after.ino) {
      throw unsafeWatchPathError('watched source changed identity while being read');
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function readWatchedSource(watch) {
  if (sourceWatch !== watch) return;
  watch.timer = null;
  try {
    const content = readCanonicalWatchedFile(watch.filePath);
    const digest = contentDigest(content);
    watch.retrying = false;
    if (digest === watch.digest) return;   // chmod/重复 rename 等元数据噪音
    watch.digest = digest;
    watch.missing = false;
    sendSourceChange(watch, { exists: true, content });
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      sendSourceChange(watch, { exists: null, error: String(err && err.message || err) });
      stopSourceWatchInstance(watch);
      return;
    }
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
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (navigationEvent, url) => {
    if (url !== RENDERER_INDEX_URL) navigationEvent.preventDefault();
  });
  win.webContents.on('will-frame-navigate', (navigationEvent, details) => {
    // GrapesJS uses child frames for the editable canvas; only top-frame
    // navigation is owned by the application shell and must be locked down.
    if (details && details.isMainFrame && details.url !== RENDERER_INDEX_URL) {
      navigationEvent.preventDefault();
    }
  });
  win.webContents.on('will-redirect', (navigationEvent, _url, _isInPlace, isMainFrame) => {
    // Keep the shell locked; child-frame redirects belong to the canvas and
    // are handled by the renderer's sanitization/isolation boundary.
    if (isMainFrame !== false) navigationEvent.preventDefault();
  });
  win.loadFile(RENDERER_INDEX_PATH);
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
    // The real macOS app intentionally stays resident after its last window
    // closes.  The isolated production runner, however, must observe a
    // process exit after exercising the same renderer-approved close path.
    if (process.env.CLAY_TEST_CLOSE) app.quit();
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Clay',
      submenu: [
        { role: 'about', label: mt('about') },
        { type: 'separator' },
        { role: 'hide', label: mt('hide') },
        { role: 'quit', label: mt('quit') },
      ],
    },
    {
      label: mt('file'),
      submenu: [
        {
          label: mt('open'),
          accelerator: 'CmdOrCtrl+O',
          click: () => win && win.webContents.send('clay-menu', 'open'),
        },
        {
          label: mt('paste'),
          accelerator: 'Shift+CmdOrCtrl+V',
          click: () => win && win.webContents.send('clay-menu', 'paste'),
        },
        { type: 'separator' },
        {
          label: mt('save'),
          accelerator: 'CmdOrCtrl+S',
          click: () => win && win.webContents.send('clay-menu', 'save'),
        },
        {
          label: mt('saveAs'),
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => win && win.webContents.send('clay-menu', 'save-as'),
        },
        {
          label: mt('exportPdf'),
          accelerator: 'CmdOrCtrl+P',
          click: () => win && win.webContents.send('clay-menu', 'export-pdf'),
        },
        { type: 'separator' },
        {
          label: mt('copyCode'),
          accelerator: 'CmdOrCtrl+E',
          click: () => win && win.webContents.send('clay-menu', 'copy-code'),
        },
      ],
    },
    {
      label: mt('edit'),
      submenu: [
        { role: 'undo', label: mt('undo') },
        { role: 'redo', label: mt('redo') },
        { type: 'separator' },
        { role: 'cut', label: mt('cut') },
        { role: 'copy', label: mt('copy') },
        { role: 'paste', label: mt('pasteEdit') },
        { role: 'selectAll', label: mt('selectAll') },
      ],
    },
    {
      label: mt('view'),
      submenu: [
        { role: 'reload', label: mt('reload') },
        { role: 'togglefullscreen', label: mt('fullscreen') },
        { role: 'toggleDevTools', label: mt('devtools') },
      ],
    },
    { label: mt('window'), submenu: [{ role: 'minimize', label: mt('minimize') }, { role: 'close', label: mt('close') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* 另存为:sourcePath 是导入时的原文件。
 * 默认存到它旁边、改个名,并且真要覆盖原文件时必须二次确认 ——
 * 用户的原稿不能被 Clay 无声改掉。 */
ipcMain.handle('clay:save-file', async (event, defaultName, content, sourcePath) => {
  if (!isTrustedMainFrameEvent(event) || typeof content !== 'string') return null;
  const safeSourcePath = sourcePath ? hasFileCapability(sourcePath, 'write') : null;
  if (sourcePath && !safeSourcePath) return null;
  const safeDefaultName = sanitizeDefaultFileName(defaultName, 'page-clay.html');
  const startDir = safeSourcePath ? path.dirname(safeSourcePath) : app.getPath('documents');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: mt('saveAs').replace(/…$/, ''),
    defaultPath: path.join(startDir, safeDefaultName),
    filters: [{ name: mt('htmlPage'), extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;

  const safeFilePath = resolveHtmlPath(filePath);
  if (!safeFilePath) return null;

  if (safeSourcePath && safeFilePath === safeSourcePath) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [mt('cancel'), mt('overwrite')],
      defaultId: 0,
      cancelId: 0,
      message: mt('overwriteMessage'),
      detail: path.basename(safeSourcePath) + '\n\n' + mt('overwriteDetail'),
    });
    if (response !== 1) return null;
  }

  grantFileCapability(safeFilePath, { read: true, write: true });
  let tmp = '';
  try {
    tmp = safeFilePath + '.claytmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, safeFilePath);
    refreshInternalWatch(safeFilePath, content);
    return safeFilePath;
  } catch (err) {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (cleanupErr) { /* 清理失败无所谓 */ } }
    return null;
  }
});

/* 保存(⌘S):直接写回源文件,Word 语义。
 * 不弹框 —— 弹框的那条路是另存为。走到这里说明用户明确要"存回原处"。
 * 同样先写临时文件再 rename,存到一半崩溃不能把用户的源文件毁成半截。 */
ipcMain.handle('clay:write-file', async (event, filePath, content) => {
  if (!isTrustedMainFrameEvent(event) || typeof content !== 'string') {
    return { ok: false, error: mt('invalidPath') };
  }
  const safeFilePath = hasFileCapability(filePath, 'write');
  if (!safeFilePath) return { ok: false, error: mt('invalidPath') };
  let tmp = '';
  try {
    tmp = safeFilePath + '.claytmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, safeFilePath);
    refreshInternalWatch(safeFilePath, content);
    return { ok: true };
  } catch (err) {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (cleanupErr) { /* 清理失败无所谓 */ } }
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
ipcMain.handle('clay:export-pdf', async (event, defaultName, html, width, height, sourcePath) => {
  if (!isTrustedMainFrameEvent(event) || typeof html !== 'string') {
    return { ok: false, error: mt('invalidData') };
  }
  const safeSourcePath = sourcePath ? hasFileCapability(sourcePath, 'read') : null;
  if (sourcePath && !safeSourcePath) return { ok: false, error: mt('invalidPath') };
  // 渲染宽度跟着渲染进程里"当前选中的视图"走(桌面/平板/手机),不再固定死;
  // 传值异常(没传、非数)时退回旧的桌面默认宽度,兜底不出错。
  const requestedWidth = Number.isFinite(width) && width > 0 ? Math.max(1, Math.round(width)) : 1280;
  if (requestedWidth > PDF_MAX_WIDTH) return { ok: false, error: mt('pdfTooWide') };
  const shotWidth = requestedWidth;
  const shotHeight = Number.isFinite(height) && height > 0 ? Math.max(1, Math.round(Math.min(height, 4000))) : 900;
  const safeDefaultName = sanitizeDefaultFileName(defaultName, 'page.pdf');
  let filePath;
  if (process.env.CLAY_PDF_OUT) {
    // 测试接缝(同 CLAY_USERDATA 思路):跳过原生对话框,直接写到指定路径。env 不设时零影响。
    filePath = process.env.CLAY_PDF_OUT;
  } else {
    const res = await dialog.showSaveDialog(win, {
      title: mt('exportPdf').replace(/…$/, ''),
      defaultPath: path.join(app.getPath('documents'), safeDefaultName),
      filters: [{ name: mt('pdfFile'), extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    filePath = res.filePath;
  }

  if (typeof filePath !== 'string' || !filePath || !path.isAbsolute(filePath)
    || path.extname(filePath).toLowerCase() !== '.pdf') {
    return { ok: false, error: mt('invalidPath') };
  }

  let shotWin = null;
  let wrapWin = null;
  let tmpHtml = '';
  let tmpWrap = '';
  let tmpPdf = '';
  let shotRenderFailure = null;
  let wrapRenderFailure = null;
  let shotGoneHandler = null;
  let wrapGoneHandler = null;
  try {
    const pdfPartition = 'clay-pdf-' + process.pid + '-' + Date.now() + '-'
      + crypto.randomBytes(6).toString('hex');
    shotWin = new BrowserWindow({
      show: false,
      width: shotWidth,
      height: shotHeight,
      useContentSize: true,
      webPreferences: {
        javascript: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: pdfPartition,
      },
    });
    shotWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const blockShotNavigation = (navigationEvent, url) => {
      if (tmpHtml && url !== pathToFileURL(tmpHtml).href) navigationEvent.preventDefault();
    };
    const blockShotFrameNavigation = (navigationEvent, details) => {
      if (tmpHtml && details && details.url !== pathToFileURL(tmpHtml).href) navigationEvent.preventDefault();
    };
    shotWin.webContents.on('will-navigate', blockShotNavigation);
    shotWin.webContents.on('will-frame-navigate', blockShotFrameNavigation);
    shotWin.webContents.on('will-redirect', (navigationEvent) => navigationEvent.preventDefault());
    shotGoneHandler = (_goneEvent, details) => {
      shotRenderFailure = details && (details.reason || details.exitCode)
        ? String(details.reason || details.exitCode)
        : 'renderer process gone';
    };
    shotWin.webContents.on('render-process-gone', shotGoneHandler);
    const shotSession = shotWin.webContents.session;
    const blockShotNetwork = (details, callback) => {
      let protocol = '';
      try { protocol = new URL(details.url).protocol; } catch (e) { protocol = ''; }
      const passiveRemoteTypes = ['stylesheet', 'image', 'font', 'media'];
      if (protocol === 'http:' || protocol === 'https:') {
        callback({ cancel: !passiveRemoteTypes.includes(details.resourceType) });
        return;
      }
      callback({ cancel: ['ws:', 'wss:', 'ftp:'].includes(protocol) });
    };
    shotSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, blockShotNetwork);
    /* 相对路径的图片/素材(AI 工具常见的"HTML + 图片文件夹"组合):这份 HTML 被写到
     * 系统临时目录去渲染截图,和原文件根本不在同一个文件夹,相对路径全部解析错位、
     * 图会裂 —— 跟画布编辑时踩过的是同一类问题(见 renderer/app.js 的 applyCanvasBase),
     * 这里同样插一个指回源文件目录的 <base>,只影响这次内部渲染,不进最终 PDF 内容。 */
    const htmlToRender = makePdfSnapshotHtml(html, safeSourcePath);
    tmpHtml = makePdfTempPath('clay-pdf');
    fs.writeFileSync(tmpHtml, htmlToRender, { encoding: 'utf8', flag: 'wx' });
    await shotWin.loadFile(tmpHtml);

    // 先滚一遍触发滚动渐显(opacity:0→显示),回顶;再暂停当前动画帧。
    // 不能通过改 CSS 来“稳定”页面:animation:none 会把元素重置到动画前,
    // fixed/sticky→static 更会直接改变文档流,这是此前 PDF 和 Clay 明显错位的根因。
    // javascript:false 会阻止页面脚本和计时器,因此就绪状态在主进程轮询,
    // 受控探针只做同步 DOM 测量;这样既不恢复作者脚本,也不会无界等待坏资源。
    await waitForPdfReadiness(shotWin.webContents);
    if (shotRenderFailure) throw new Error(mt('pdfSnapshotFailed') + ': ' + shotRenderFailure);
    let dim = validatePdfDimensions(await readPdfDimensions(shotWin.webContents));
    const initialWidth = dim.w;
    const initialHeight = dim.h;
    if (initialWidth > PDF_MAX_WIDTH) throw new Error(mt('pdfTooWide'));
    if (initialHeight > PDF_MAX_HEIGHT) throw new Error(mt('pdfTooTall'));
    ensurePdfSurfaceWithinLimit(dim);
    const scrollStep = Math.max(240, shotHeight * 0.8);
    for (let y = 0; y <= initialHeight; y += scrollStep) {
      await executePdfProbe(shotWin.webContents, `scrollTo(0, ${Math.round(y)})`);
      await delay(50);
    }
    await executePdfProbe(shotWin.webContents, 'scrollTo(0, 0); try { document.getAnimations().forEach((a) => a.pause()); } catch (e) {}');
    await delay(250); // 让滚动触发的短过渡落到终态
    dim = validatePdfDimensions(await readPdfDimensions(shotWin.webContents));
    if (shotRenderFailure) throw new Error(mt('pdfSnapshotFailed') + ': ' + shotRenderFailure);
    const h = dim.h;
    const w = dim.w;
    if (w > PDF_MAX_WIDTH) throw new Error(mt('pdfTooWide'));
    if (h > PDF_MAX_HEIGHT) throw new Error(mt('pdfTooTall'));
    ensurePdfSurfaceWithinLimit(dim);

    // CDP 全页截图:不改窗口尺寸,captureBeyondViewport 抓完整页面(任意长度都能截)
    const dbg = shotWin.webContents.debugger;
    let debuggerAttached = false;
    let shot;
    try {
      dbg.attach('1.3');
      debuggerAttached = true;
      shot = await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
      });
    } finally {
      if (debuggerAttached) { try { dbg.detach(); } catch (detachErr) { /* 已关闭 */ } }
    }

    // 把整页图片包成一张等大的单页 PDF(纯 <img>,没有 vh 可重排,必是单页)
    wrapWin = new BrowserWindow({
      show: false,
      width: w,
      height: Math.min(h, 900),
      useContentSize: true,
      webPreferences: {
        javascript: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: pdfPartition,
      },
    });
    wrapWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    wrapGoneHandler = (_goneEvent, details) => {
      wrapRenderFailure = details && (details.reason || details.exitCode)
        ? String(details.reason || details.exitCode)
        : 'renderer process gone';
    };
    wrapWin.webContents.on('render-process-gone', wrapGoneHandler);
    const blockWrapNavigation = (navigationEvent, url) => {
      if (tmpWrap && url !== pathToFileURL(tmpWrap).href) navigationEvent.preventDefault();
    };
    const blockWrapFrameNavigation = (navigationEvent, details) => {
      if (tmpWrap && details && details.url !== pathToFileURL(tmpWrap).href) navigationEvent.preventDefault();
    };
    wrapWin.webContents.on('will-navigate', blockWrapNavigation);
    wrapWin.webContents.on('will-frame-navigate', blockWrapFrameNavigation);
    wrapWin.webContents.on('will-redirect', (navigationEvent) => navigationEvent.preventDefault());
    const wrap = '<!doctype html><html><head><meta charset="utf-8"><style>'
      + '@page { size: ' + w + 'px ' + h + 'px; margin: 0; }'
      + '*{margin:0;padding:0} img{display:block;width:' + w + 'px;height:' + h + 'px}'
      + '</style></head><body><img src="data:image/png;base64,' + shot.data + '"></body></html>';
    tmpWrap = makePdfTempPath('clay-pdf-wrap');
    fs.writeFileSync(tmpWrap, wrap, { encoding: 'utf8', flag: 'wx' });
    await wrapWin.loadFile(tmpWrap);
    // 等那张整页大图真正解码完再打印,替代固定 setTimeout(300):图未就绪时 printToPDF 会出空白页
    await waitForPdfReadiness(wrapWin.webContents);

    if (wrapRenderFailure) throw new Error(mt('pdfSnapshotFailed') + ': ' + wrapRenderFailure);

    const pdf = await wrapWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    tmpPdf = filePath + '.claytmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(tmpPdf, pdf, { flag: 'wx' });
    fs.renameSync(tmpPdf, filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (shotWin) { try { shotWin.destroy(); } catch (e) { /* 已销毁 */ } }
    if (wrapWin) { try { wrapWin.destroy(); } catch (e) { /* 已销毁 */ } }
    if (tmpHtml) { try { fs.unlinkSync(tmpHtml); } catch (e) { /* 清理失败无所谓 */ } }
    if (tmpWrap) { try { fs.unlinkSync(tmpWrap); } catch (e) { /* 清理失败无所谓 */ } }
    if (tmpPdf) { try { fs.unlinkSync(tmpPdf); } catch (e) { /* 已 rename 或清理失败 */ } }
  }
});

ipcMain.handle('clay:confirm', async (event, opts) => {
  if (!isTrustedMainFrameEvent(event) || !opts || !Array.isArray(opts.buttons)) return 0;
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
  if (!isTrustedMainFrameEvent(event) || !closeRequestPending) return;
  closeRequestPending = false;
  if (!shouldClose) return;
  closeApproved = true;
  win.close();
});

// 只有隔离用户数据的打包回归才开启:从主进程发起和红灯/⌘Q 同路的关窗。
if (process.env.CLAY_TEST_CLOSE) {
  ipcMain.on('clay:test-close-window', (event) => {
    if (isTrustedMainFrameEvent(event)) win.close();
  });
  ipcMain.on('clay:test-trigger-stale-watch-error', (event) => {
    if (!isTrustedMainFrameEvent(event) || !previousSourceWatchForTest
      || !previousSourceWatchForTest.watcher) return;
    previousSourceWatchForTest.watcher.emit('error', new Error('test stale watcher error'));
  });
  ipcMain.handle('clay:test-source-watch-path', (event) => {
    if (!isTrustedMainFrameEvent(event)) return null;
    return sourceWatch ? sourceWatch.filePath : null;
  });
}

/* 拖拽文件的 File.path 只能由 preload 的 webUtils 解析;解析后同步登记一次能力,
 * 随后的 readPath/writeFile 仍会经过 sender + frame + capability 三重校验。 */
ipcMain.on('clay:authorize-path-sync', (event, filePath) => {
  event.returnValue = isTrustedMainFrameEvent(event)
    && !!grantFileCapability(filePath, { read: true, write: true, mustExist: true });
});

/* 最近文件用:过滤出仍然存在的路径(删除/移动的会被剔除,主页据此不显示) */
ipcMain.handle('clay:filter-existing', async (event, paths) => {
  if (!isTrustedMainFrameEvent(event)) return [];
  if (!Array.isArray(paths)) return [];
  return paths.filter((p) => {
    return !!hasFileCapability(p, 'read', { mustExist: true });
  });
});

/* 按路径直接读取(从"最近编辑"点开一个文件用,不弹对话框) */
ipcMain.handle('clay:read-path', async (event, filePath) => {
  const safeFilePath = isTrustedMainFrameEvent(event)
    ? hasFileCapability(filePath, 'read', { mustExist: true })
    : null;
  if (!safeFilePath) return null;
  try {
    return {
      name: path.basename(safeFilePath),
      path: safeFilePath,
      content: fs.readFileSync(safeFilePath, 'utf8'),
    };
  } catch (err) {
    return null;
  }
});

/* 当前源文件监听。返回启动监听这一刻的内容,让“应用关闭期间文件已被 AI 改过”
 * 也能在用户重新点开标签页时立即被发现,而不是必须等下一次磁盘事件。 */
ipcMain.handle('clay:watch-source', async (e, filePath) => {
  if (!isTrustedMainFrameEvent(e)) return { ok: false, error: mt('invalidPath') };
  stopSourceWatch();
  // 允许已授权的源文件暂时不存在,这样 renderer 能收到 exists:false 并提供“重建源文件”流程。
  const safeFilePath = hasFileCapability(filePath, 'read');
  if (!safeFilePath) return { ok: false, error: mt('invalidPath') };

  const target = safeFilePath;
  const dir = path.dirname(target);
  let initialContent = null;
  let initialExists = false;
  try {
    initialContent = readCanonicalWatchedFile(target);
    initialExists = true;
  } catch (err) {
    try { initialExists = fs.statSync(target).isFile(); } catch (statErr) { initialExists = false; }
    // A file that still exists but cannot be read is an actual watch failure.
    // A missing authorized file is different: keep watching its parent so an
    // external atomic save/recreation is detected without a tab round-trip.
    if (initialExists || !err || err.code !== 'ENOENT') {
      return { ok: false, path: target, exists: initialExists, error: String(err && err.message || err) };
    }
  }

  try {
    const sender = e.sender;
    const watch = {
      sender,
      filePath: target,
      fileName: path.basename(target).normalize('NFC'),
      digest: initialExists ? contentDigest(initialContent) : null,
      missing: !initialExists,
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
      if (sourceWatch !== watch) return;
      sendSourceChange(watch, { exists: null, error: String(err && err.message || err) });
      stopSourceWatchInstance(watch);
    });
    sourceWatch = watch;
    return initialExists
      ? { ok: true, path: target, exists: true, content: initialContent }
      : { ok: true, path: target, exists: false };
  } catch (err) {
    return { ok: false, path: target, exists: initialExists, error: String(err && err.message || err) };
  }
});

ipcMain.handle('clay:unwatch-source', async (e) => {
  if (!isTrustedMainFrameEvent(e)) return { ok: false, error: mt('invalidPath') };
  stopSourceWatch(e.sender.id);
  return { ok: true };
});

ipcMain.handle('clay:open-file', async (event) => {
  if (!isTrustedMainFrameEvent(event)) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: mt('open').replace(/…$/, ''),
    filters: [{ name: mt('htmlPage'), extensions: ['html', 'htm'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;
  const safeFilePath = grantFileCapability(filePaths[0], { read: true, write: true, mustExist: true });
  if (!safeFilePath) return null;
  try {
    return {
      name: path.basename(safeFilePath),
      path: safeFilePath,
      content: fs.readFileSync(safeFilePath, 'utf8'),
    };
  } catch (err) {
    return null;
  }
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
  const bak = p + '.bak';
  const incoming = parseWorkspace(json);
  if (!incoming) return { ok: false, error: mt('invalidData') };
  const normalizedJson = JSON.stringify(incoming);
  const primaryState = inspectWorkspaceFile(p);
  const backupState = inspectWorkspaceFile(bak);
  const current = primaryState.status === 'valid' ? primaryState : null;
  const existingBackup = backupState.status === 'valid' ? backupState : null;
  const corruptCopies = [];

  /* 不论接下来写入主档还是备份,先把所有损坏的候选原件留一份唯一副本。
   * 这样“双损坏”不会在一次正常保存后变成无法诊断的静默丢失。 */
  for (const candidate of [
    [p, primaryState],
    [bak, backupState],
  ]) {
    if (candidate[1].status !== 'corrupt') continue;
    corruptCopies.push(preserveCorruptWorkspaceFile(candidate[0]));
  }

  /* 只允许“已验证的当前档”更新 .bak。损坏主档必须被跳过,否则一次正常保存
   * 就会把原本可恢复的备份覆盖成坏数据。空工作区也不覆盖已有的有内容备份。 */
  if (current && current.value.docs.length > 0) {
    const backupTmp = bak + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    try {
      fs.copyFileSync(p, backupTmp);
      if (!readValidWorkspace(backupTmp)) throw new Error('workspace backup validation failed');
      fs.renameSync(backupTmp, bak);
    } catch (err) {
      try { fs.unlinkSync(backupTmp); } catch (cleanupErr) { /* 清理失败无所谓 */ }
      // 备份失败不能让正常的用户保存直接失败,但绝不回退到复制损坏主档。
    }
  } else if (existingBackup) {
    // 明确保留有效 .bak;这里故意不触碰它,尤其是当前档为空或损坏时。
  }

  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(tmp, normalizedJson, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, p);   // 原子替换:写一半崩了也不会留半截文件
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (cleanupErr) { /* 清理失败无所谓 */ }
    throw err;
  }
  // 旧版本的工作区只存在 localStorage。renderer 第一次迁移并落盘后，
  // 当前会话也要立刻获得这些已持久化 HTML 路径的能力，不能要求用户重启。
  seedWorkspaceCapabilities(incoming);
  return { ok: true, bytes: Buffer.byteLength(normalizedJson, 'utf8'), corruptCopies };
}

ipcMain.handle('clay:save-workspace', async (event, json) => {
  if (!isTrustedMainFrameEvent(event)) return { ok: false, error: mt('invalidData') };
  try {
    return guardedWrite(json);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.on('clay:save-workspace-sync', (e, json) => {
  if (!isTrustedMainFrameEvent(e)) { e.returnValue = false; return; }
  try {
    e.returnValue = guardedWrite(json).ok;
  } catch (err) {
    e.returnValue = false;
  }
});

ipcMain.handle('clay:load-workspace', async (event) => {
  if (!isTrustedMainFrameEvent(event)) return { status: 'error', json: null };
  try {
    const p = workspacePath();
    const primaryState = inspectWorkspaceFile(p);
    const backupState = inspectWorkspaceFile(p + '.bak');
    const selected = primaryState.status === 'valid'
      ? { value: primaryState.value, source: 'primary' }
      : backupState.status === 'valid'
        ? { value: backupState.value, source: 'backup' }
        : null;
    if (!selected) {
      return primaryState.status === 'missing' && backupState.status === 'missing'
        ? { status: 'missing', json: null }
        : { status: 'corrupt', json: null };
    }
    seedWorkspaceCapabilities(selected.value);
    return { status: 'valid', json: JSON.stringify(selected.value), source: selected.source };
  } catch (err) {
    return { status: 'corrupt', json: null };
  }
});

ipcMain.on('clay:set-locale', (event, locale) => {
  if (!isTrustedMainFrameEvent(event)) return;
  const next = normalizeLocale(locale);
  if (next === currentLocale) return;
  currentLocale = next;
  buildMenu();
});

ipcMain.on('clay:reload-for-locale', (event, locale) => {
  if (!isTrustedMainFrameEvent(event)) return;
  currentLocale = normalizeLocale(locale);
  buildMenu();
  if (!event.sender.isDestroyed()) {
    setImmediate(() => {
      if (!event.sender.isDestroyed() && event.sender.getURL() === RENDERER_INDEX_URL) event.sender.reload();
    });
  }
});

app.whenReady().then(() => {
  currentLocale = normalizeLocale(app.getLocale());
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Small pure helper export for the main-process regression suite; the app
// still boots normally when Electron loads this file as its entry point.
module.exports = { sanitizeDefaultFileName };
