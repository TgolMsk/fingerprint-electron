const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('fpDemo', {
  switchAccount: (id) => ipcRenderer.send('switch-account', id),
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (partial) => ipcRenderer.invoke('add-account', partial),
  getState: () => ipcRenderer.invoke('get-state'),
  navigate: (request) => ipcRenderer.invoke('navigate', request),
  action: (request) => ipcRenderer.invoke('instance-action', request),
  setLayout: (layout) => ipcRenderer.invoke('set-layout', layout),
  inspect: (id) => ipcRenderer.invoke('inspect-instance', id),
  exportReport: (id) => ipcRenderer.invoke('export-report', id),
  revealExport: () => ipcRenderer.invoke('reveal-export'),
  openManagement: () => ipcRenderer.invoke('open-management'),
  onAccountsChanged: (callback) => subscribe('accounts-changed', callback),
  onStateChanged: (callback) => subscribe('state-changed', callback),
});
