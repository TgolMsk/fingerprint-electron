// 翻译业务占位（运行在隔离世界）：
// 监听聊天 DOM → IPC 给主进程翻译 → 插回译文。禁止修改任何浏览器对象。
const { ipcRenderer } = require('electron');

// 未接线的占位实现：将来由主进程接翻译服务
function translateViaMain(text) {
  return ipcRenderer.invoke('translate-text', text);
}

// MutationObserver 骨架：将来在回调里收集聊天消息节点、调用 translateViaMain、插回译文
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    void mutation; // TODO: 识别聊天消息 DOM
  }
});

window.addEventListener('DOMContentLoaded', () => {
  observer.observe(document.body, { childList: true, subtree: true });
});

void translateViaMain;
