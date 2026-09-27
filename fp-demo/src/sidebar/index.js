'use strict';

const api = window.fpDemo;
const el = (id) => document.getElementById(id);
const MAX_INSTANCES = 6;
let state = { accounts: [], currentId: null, layout: 'single', instances: [], versions: {}, inspection: null };
let adding = false;
let inspecting = false;
let exporting = false;
let renderedInspection = null;
let feedbackTimer = null;
let addressAccountId = null;

function showFeedback(message, error = false) {
  const box = el('feedback');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
  clearTimeout(feedbackTimer);
  if (error) box.scrollIntoView({ block: 'nearest' });
  if (!error) feedbackTimer = setTimeout(() => { box.hidden = true; }, 6500);
}

async function invoke(work, success) {
  try {
    const result = await work();
    if (result?.error) throw new Error(result.error);
    if (success) showFeedback(success);
    return result;
  } catch (error) {
    showFeedback(error?.message || String(error), true);
    return null;
  }
}

function activeAccount() { return state.accounts.find((account) => account.id === state.currentId); }
function activeInstance() { return state.instances.find((instance) => instance.id === state.currentId); }
function numberOf(id) { return String(state.accounts.findIndex((account) => account.id === id) + 1).padStart(2, '0'); }
function valueText(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function addFact(list, label, value, mono = false) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = valueText(value);
  if (mono) description.className = 'mono';
  list.append(term, description);
}

function focusAccount(id) {
  state.currentId = id;
  render();
  invoke(() => api.switchAccount(id));
}

function renderAccounts() {
  const fragment = document.createDocumentFragment();
  state.accounts.forEach((account, index) => {
    const instance = state.instances.find((view) => view.id === account.id);
    const item = document.createElement('div');
    item.className = `item${account.id === state.currentId ? ' active' : ''}`;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-pressed', String(account.id === state.currentId));
    const avatar = document.createElement('span');
    avatar.className = 'instance-avatar';
    avatar.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div');
    copy.className = 'instance-copy';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = account.name;
    const subtitle = document.createElement('div');
    subtitle.className = 'proxy';
    subtitle.textContent = `${account.fp?.navigator?.languages?.[0] || 'en-US'} · ${account.proxy ? '代理连接' : '独立会话'}`;
    subtitle.title = account.proxy ? `代理：${account.proxy}` : `独立持久会话 · ${account.id}`;
    copy.append(name, subtitle);
    const status = document.createElement('span');
    status.className = `instance-status${instance?.error ? ' error' : instance?.loading ? ' loading' : ''}`;
    status.title = instance?.error || (instance?.loading ? '加载中' : '已就绪');
    item.append(avatar, copy, status);
    item.addEventListener('click', () => focusAccount(account.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusAccount(account.id); }
    });
    fragment.append(item);
  });
  el('list').replaceChildren(fragment);
  el('account-count').textContent = `${state.accounts.length} / ${MAX_INSTANCES}`;
  el('no-accounts').hidden = state.accounts.length > 0;
  el('add').disabled = adding || state.accounts.length >= MAX_INSTANCES;
  el('add').querySelector('span').textContent = adding ? '正在创建…' : '添加实例';
  el('limit-note').hidden = state.accounts.length < MAX_INSTANCES;
}

function renderConfiguration() {
  const account = activeAccount();
  const facts = el('config-summary');
  facts.replaceChildren();
  el('active-panel').hidden = !account;
  if (!account) return;
  const fp = account.fp || {};
  el('active-number').textContent = `INSTANCE ${numberOf(account.id)}`;
  addFact(facts, 'Seed', fp.seed, true);
  addFact(facts, '语言', fp.navigator?.languages);
  addFact(facts, '时区', fp.timezone);
  addFact(facts, '设备', `${fp.navigator?.hardwareConcurrency || '—'} 核 · ${fp.navigator?.deviceMemory || '—'} GB`);
  addFact(facts, '屏幕', fp.screen ? `${fp.screen.width} × ${fp.screen.height} · DPR ${fp.screen.dpr}` : null);
  addFact(facts, '显卡', fp.webgl?.renderer);
  addFact(facts, '扰动', ['canvas', 'audio', 'rects'].filter((key) => fp.noise?.[key]).map((key) => key[0].toUpperCase() + key.slice(1)).join(' · ') || '全部关闭');
  el('inspect').disabled = inspecting;
  el('inspect').querySelector('span').textContent = inspecting ? '读取中…' : '读取指纹';
  el('export').disabled = exporting;
  el('export').textContent = exporting ? '导出中…' : '导出报告';
}

function renderInspection() {
  const inspection = state.inspection;
  const panel = el('inspection-panel');
  panel.hidden = !inspection;
  if (!inspection || inspection === renderedInspection) return;
  renderedInspection = inspection;
  const account = state.accounts.find((candidate) => candidate.id === inspection.id);
  el('inspection-label').textContent = `${account?.name || '当前页面'} · 当前页面读取值`;
  el('inspection-time').textContent = inspection.at ? new Date(inspection.at).toLocaleTimeString('zh-CN', { hour12: false }) : '';
  const list = el('inspection-values');
  list.replaceChildren();
  if (inspection.error) { addFact(list, '错误', inspection.error); return; }
  const values = inspection.values || {};
  const section = (key) => values[key]?.data || {};
  const nav = section('navigator');
  const screen = section('screen');
  const gl = section('webgl');
  addFact(list, '语言', nav.languages || nav.language);
  addFact(list, '时区', section('intl').dateTime?.timeZone);
  addFact(list, '线程', nav.hardwareConcurrency);
  addFact(list, '内存', nav.deviceMemory ? `${nav.deviceMemory} GB` : null);
  addFact(list, '屏幕', screen.width ? `${screen.width} × ${screen.height}` : null);
  addFact(list, 'WebGL', gl.unmaskedRenderer || gl.renderer);
  addFact(list, '自动化', nav.webdriver);
  for (const [key, label] of [['canvas', 'Canvas'], ['audio', 'Audio'], ['rects', 'Rects']]) {
    const data = section(key);
    const hash = data.hash?.value || data.hash || data.pixelHash?.value || data.sampleHash?.value;
    const status = values[key]?.status;
    if (hash) addFact(list, label, hash, true);
    else if (status && status !== 'ok') addFact(list, label, values[key].error || status);
  }
}

function renderViewHeaders() {
  const fragment = document.createDocumentFragment();
  const visible = state.instances.filter((instance) => instance.visible !== false && (state.layout === 'compare' || instance.id === state.currentId));
  for (const instance of visible) {
    const account = state.accounts.find((candidate) => candidate.id === instance.id);
    const bounds = instance.headerBounds || (instance.bounds && { x: instance.bounds.x, y: instance.bounds.y - 32, width: instance.bounds.width, height: 32 });
    if (!account || !bounds) continue;
    const header = document.createElement('div');
    header.className = `view-header${instance.id === state.currentId ? ' active' : ''}`;
    Object.assign(header.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height || 32}px` });
    header.title = instance.error || instance.url || account.name;
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    for (const [className, text] of [['view-header-number', numberOf(account.id)], ['view-header-name', account.name], ['view-header-divider', ''], ['view-header-title', instance.error || instance.title || '等待页面加载'], [`view-header-status${instance.error ? ' error' : ''}`, instance.error ? '加载失败' : instance.loading ? '加载中' : '独立会话']]) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      header.append(span);
    }
    header.addEventListener('click', () => focusAccount(account.id));
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusAccount(account.id); }
    });
    fragment.append(header);
  }
  el('view-headers').replaceChildren(fragment);
  el('workspace-empty').hidden = state.accounts.length > 0;
}

function renderToolbar() {
  const account = activeAccount();
  const instance = activeInstance();
  // A deliberate instance switch must update the address even if a previous
  // navigation left focus in the input. Keep an in-progress edit on this tab.
  if (addressAccountId !== state.currentId || document.activeElement !== el('url')) {
    el('url').value = instance?.url || account?.url || '';
    addressAccountId = state.currentId;
  }
  el('back').disabled = !instance?.canGoBack;
  el('forward').disabled = !instance?.canGoForward;
  el('reload').hidden = Boolean(instance?.loading);
  el('stop').hidden = !instance?.loading;
  el('address-indicator').classList.toggle('loading', Boolean(instance?.loading));
  for (const id of ['reload', 'stop', 'open-current', 'open-all', 'reload-all', 'devtools', 'layout-single', 'layout-compare']) el(id).disabled = !account;
  document.querySelectorAll('.destination').forEach((button) => { button.disabled = !account; });
  for (const layout of ['single', 'compare']) {
    el(`layout-${layout}`).classList.toggle('active', state.layout === layout);
    el(`layout-${layout}`).setAttribute('aria-pressed', String(state.layout === layout));
  }
  const versions = state.versions || {};
  el('kernel-version').textContent = versions.fpkernel ? `FP Kernel ${versions.fpkernel === true ? '已启用' : versions.fpkernel}` : 'FP Kernel';
  el('runtime-version').textContent = versions.chrome ? `Chromium ${versions.chrome.split('.')[0]}` : '';
  el('runtime-version').title = `Electron ${versions.electron || '—'} · Chromium ${versions.chrome || '—'}`;
}

function render() { renderAccounts(); renderConfiguration(); renderInspection(); renderToolbar(); renderViewHeaders(); }

function applyState(next) {
  if (!next || typeof next !== 'object') return;
  state = { ...state, ...next };
  state.accounts ||= [];
  state.instances ||= [];
  if (!state.accounts.some((account) => account.id === state.currentId)) state.currentId = state.accounts[0]?.id || null;
  render();
}

async function navigate(all = false, url = el('url').value) {
  const trimmed = url.trim();
  if (!trimmed) { showFeedback('请先输入网址。', true); el('url').focus(); return; }
  await invoke(() => api.navigate({ id: state.currentId, url: trimmed, all }));
}

el('navigation-form').addEventListener('submit', (event) => { event.preventDefault(); navigate(); });
el('open-all').addEventListener('click', () => navigate(true));
for (const type of ['back', 'forward', 'reload', 'stop', 'devtools']) el(type).addEventListener('click', () => invoke(() => api.action({ id: state.currentId, type })));
el('reload-all').addEventListener('click', () => invoke(() => api.action({ type: 'reload', all: true })));
for (const layout of ['single', 'compare']) el(`layout-${layout}`).addEventListener('click', () => invoke(() => api.setLayout(layout)));
document.querySelectorAll('.destination').forEach((button) => button.addEventListener('click', () => navigate(el('sites-all').checked, button.dataset.url)));

el('add').addEventListener('click', async () => {
  if (adding || state.accounts.length >= MAX_INSTANCES) return;
  adding = true;
  renderAccounts();
  const account = await invoke(() => api.addAccount({
    name: el('new-name').value.trim() || `实例 ${state.accounts.length + 1}`,
    url: 'fp-test://local/',
    language: el('new-language').value,
    timezone: el('new-timezone').value.trim() || 'America/New_York',
    noise: { canvas: el('noise-canvas').checked, audio: el('noise-audio').checked, rects: el('noise-rects').checked },
  }));
  adding = false;
  if (account?.id) {
    el('new-name').value = '';
    state.currentId = account.id;
    await invoke(() => api.switchAccount(account.id));
    const next = await invoke(() => api.getState());
    if (next) applyState(next);
    showFeedback(`已创建 ${account.name}，配置已保存。`);
  }
  render();
});

el('inspect').addEventListener('click', async () => {
  if (inspecting || !state.currentId) return;
  inspecting = true;
  renderConfiguration();
  const result = await invoke(() => api.inspect(state.currentId));
  inspecting = false;
  if (result) {
    if (result.values || result.config) state.inspection = result;
    const next = await invoke(() => api.getState());
    if (next) applyState(next);
    el('inspection-panel').open = true;
    el('inspection-panel').scrollIntoView({ block: 'nearest' });
    showFeedback('已读取页面指纹，快照显示在下方。');
  }
  render();
});

el('export').addEventListener('click', async () => {
  if (exporting || !state.currentId) return;
  exporting = true;
  renderConfiguration();
  const result = await invoke(() => api.exportReport(state.currentId));
  exporting = false;
  if (result && !result.canceled) {
    showFeedback(`报告已导出${result.path ? `：${result.path}` : ''}`);
    el('reveal-export').hidden = false;
  }
  renderConfiguration();
});
el('reveal-export').addEventListener('click', () => invoke(() => api.revealExport()));
el('open-management').addEventListener('click', () => invoke(() => api.openManagement()));
el('copy-inspection').addEventListener('click', async () => {
  if (!state.inspection) return;
  await invoke(() => navigator.clipboard.writeText(JSON.stringify(state.inspection, null, 2)), '完整指纹快照已复制。');
});

api.onStateChanged(applyState);
api.onAccountsChanged((accounts) => applyState({ accounts }));
invoke(() => api.getState()).then((next) => { if (next) applyState(next); });
render();
