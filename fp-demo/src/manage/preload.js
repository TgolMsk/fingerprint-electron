const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fpManagement', {
  invoke:(command, value) => ipcRenderer.invoke('fp-management', command, value),
  onChanged:(callback) => { const listener = () => callback(); ipcRenderer.on('fp-management-changed',listener); return () => ipcRenderer.removeListener('fp-management-changed',listener); },
});
