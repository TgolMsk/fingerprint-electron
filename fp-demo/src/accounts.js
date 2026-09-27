const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const { generateFingerprint } = require('./fp-generator');

// 延迟初始化：app.getPath('userData') 必须在 app ready 之后调用
let storePath = null;
function getStorePath() {
  if (!storePath) {
    storePath = path.join(app.getPath('userData'), 'accounts.json');
  }
  return storePath;
}

function loadAccounts() {
  const file = getStorePath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('accounts.json 必须为实例数组。');
    // fp 缺失的账号补生成并写回，生成后永不重新随机
    let dirty = false;
    for (const acc of list) {
      if (!acc.fp) {
        acc.fp = generateFingerprint();
        dirty = true;
      }
      // 修复早期 Demo 将完整 Chromium 版本后又拼接 .0.0.0 的格式错误。
      // 只修复已知格式，保留已有 seed 和其余指纹字段。
      const version = acc.fp.ua?.fullVersion;
      if (typeof version === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(version) && typeof acc.fp.uaString === 'string') {
        const malformed = `Chrome/${version}.0.0.0 `;
        if (acc.fp.uaString.includes(malformed)) {
          acc.fp.uaString = acc.fp.uaString.replace(malformed, `Chrome/${version} `);
          dirty = true;
        }
      }
    }
    if (dirty) saveAccounts(list);
    return list;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[accounts] 读取 accounts.json 失败:', err);
      throw new Error('账号文件读取失败，已保留原文件。请检查 accounts.json。');
    }
    return [];
  }
}

function saveAccounts(list) {
  const file = getStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function addAccount(partial) {
  const list = loadAccounts();
  const acc = {
    id: crypto.randomUUID(),
    name: partial.name || `账号 ${list.length + 1}`,
    url: partial.url || 'https://abrahamjuliot.github.io/creepjs/',
    proxy: partial.proxy || '',
    ...(partial.proxyAuth ? { proxyAuth: partial.proxyAuth } : {}),
    fp: partial.fp || generateFingerprint(),
  };
  list.push(acc);
  saveAccounts(list);
  return acc;
}

function getAccount(id) {
  return loadAccounts().find((a) => a.id === id) || null;
}

module.exports = { loadAccounts, saveAccounts, addAccount, getAccount };
