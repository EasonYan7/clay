const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('clay', {
  saveFile: (defaultName, content, sourcePath) =>
    ipcRenderer.invoke('clay:save-file', defaultName, content, sourcePath),
  // 从桌面拖文件进窗口:拖来的 File 对象本身不带磁盘路径(渲染进程沙箱化后
  // File.path 已经拿不到了),要用主进程这边的 webUtils 才能换出真实路径。
  getPathForFile: (file) => webUtils.getPathForFile(file),
  writeFile: (filePath, content) => ipcRenderer.invoke('clay:write-file', filePath, content),
  exportPdf: (defaultName, content, width, sourcePath) =>
    ipcRenderer.invoke('clay:export-pdf', defaultName, content, width, sourcePath),
  openFile: () => ipcRenderer.invoke('clay:open-file'),
  filterExisting: (paths) => ipcRenderer.invoke('clay:filter-existing', paths),
  readPath: (filePath) => ipcRenderer.invoke('clay:read-path', filePath),
  confirm: (opts) => ipcRenderer.invoke('clay:confirm', opts),
  saveWorkspace: (json) => ipcRenderer.invoke('clay:save-workspace', json),
  // 关窗瞬间用同步通道,否则异步 IPC 还没往返完窗口就没了
  saveWorkspaceSync: (json) => ipcRenderer.sendSync('clay:save-workspace-sync', json),
  loadWorkspace: () => ipcRenderer.invoke('clay:load-workspace'),
  onMenu: (cb) => ipcRenderer.on('clay-menu', (_e, action) => cb(action)),
});
