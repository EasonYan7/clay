const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clay', {
  saveFile: (defaultName, content, sourcePath) =>
    ipcRenderer.invoke('clay:save-file', defaultName, content, sourcePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('clay:write-file', filePath, content),
  exportPdf: (defaultName, content) => ipcRenderer.invoke('clay:export-pdf', defaultName, content),
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
