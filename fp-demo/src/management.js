'use strict';
const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createManagementWindow({ parent, automation, getProfiles, currentId, show = true }) {
  const file = path.join(__dirname, 'manage', 'index.html');
  const win = new BrowserWindow({ width:1120, height:850, minWidth:900, minHeight:650, parent, show,
    title:'FP Lab · 脚本与扩展', autoHideMenuBar:true, backgroundColor:'#f4f6fa',
    webPreferences:{preload:path.join(__dirname,'manage','preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false} });
  const state = () => ({ ...automation.state(), profiles:getProfiles(), currentId });
  const channel = 'fp-management';
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, command, value = {}) => {
    if (win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(file).href) throw new Error('仅脚本与扩展管理界面可调用此接口。');
    switch (command) {
      case 'state': return state();
      case 'save-script': return automation.saveScript(value);
      case 'delete-script': automation.deleteScript(value.id); return state();
      case 'run-script': return automation.runScript(value.id, value.profileIds);
      case 'import-script': {
        const pick = await dialog.showOpenDialog(win, {title:'导入 JavaScript',properties:['openFile'],filters:[{name:'JavaScript',extensions:['js']}]});
        return pick.canceled ? null : automation.importScript(pick.filePaths[0], value.profileIds);
      }
      case 'import-extension': {
        const pick = await dialog.showOpenDialog(win, {title:'选择包含 manifest.json 的扩展目录',properties:['openDirectory']});
        return pick.canceled ? null : automation.importExtension(pick.filePaths[0], value.profileIds);
      }
      case 'extension-toggle': return automation.setExtensionEnabled(value.id, value.profileId, value.enabled === true);
      case 'extension-uninstall': await automation.uninstallExtension(value.id); return state();
      case 'extension-popup': await automation.openExtensionPopup(value.id, value.profileId, {parent:win}); return true;
      case 'extension-diagnose': return automation.diagnoseExtension(value.id, value.profileId);
      case 'export-logs': {
        const pick = await dialog.showSaveDialog(win, {title:'导出执行日志',defaultPath:'fp-lab-automation-logs.json',filters:[{name:'JSON',extensions:['json']}]});
        if (pick.canceled || !pick.filePath) return null;
        fs.writeFileSync(pick.filePath, JSON.stringify(automation.state().logs,null,2),'utf8'); return pick.filePath;
      }
      default: throw new Error('未知管理操作。');
    }
  });
  const changed = () => { if (!win.isDestroyed()) win.webContents.send('fp-management-changed'); };
  automation.on('changed', changed);
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.on('closed', () => { automation.removeListener('changed', changed); ipcMain.removeHandler(channel); });
  void win.loadFile(file);
  return win;
}
module.exports = { createManagementWindow };
