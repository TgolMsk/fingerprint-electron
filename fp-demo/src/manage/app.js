'use strict';
const api = window.fpManagement, $ = id => document.getElementById(id);
let state = {scripts:[],extensions:[],logs:[],profiles:[]}, selected = null, initialized = false, busy = false;
const node = (tag, text, className) => { const value=document.createElement(tag); if(text!==undefined)value.textContent=text; if(className)value.className=className; return value; };
function message(text, error=false) { $('message').textContent=text; $('message').hidden=false; $('message').classList.toggle('error',error); }
async function call(command, value) { try { return await api.invoke(command,value); } catch(error) { message(error.message,true); return null; } }
const targetIds = container => [...$(container).querySelectorAll('input:checked')].map(input=>input.value);
function targets(container, ids) { $(container).replaceChildren(...state.profiles.map(profile=>{const label=node('label'), input=node('input'); input.type='checkbox';input.value=profile.id;input.checked=ids.includes(profile.id);label.append(input,node('span',profile.name));return label;})); }
function edit(script) {
  selected=script?.id || null;
  $('script-name').value=script?.name || '';
  $('script-code').value=script?.code || "console.log('当前页面', location.href);\nreturn { title: document.title, language: navigator.language };";
  $('script-trigger').value=script?.trigger || 'manual';$('script-enabled').checked=script?.enabled !== false;
  $('script-matches').value=(script?.matches || ['http://*/*','https://*/*']).join('\n');
  targets('script-targets',script?.profileIds || [state.currentId || state.profiles[0]?.id]); renderScripts();
}
function renderScripts() {
  $('script-list').replaceChildren(...state.scripts.map(script=>{const button=node('button',script.name,`script-item${script.id===selected?' active':''}`);button.append(node('small',`${script.enabled?'启用':'停用'} · ${script.trigger==='manual'?'手动':'加载后'} · ${script.profileIds.length} 个实例`));button.onclick=()=>edit(script);return button;}));
  $('run-script').disabled=!selected || busy;$('delete-script').disabled=!selected || busy;
}
function renderExtensions() {
  const profiles=targetIds('extension-targets'); targets('extension-targets',profiles.length?profiles:[state.currentId || state.profiles[0]?.id]);
  $('extension-list').replaceChildren(...state.extensions.map(ext=>{
    const card=node('div',undefined,'extension-card'), top=node('div',undefined,'row');top.append(node('h2',ext.name),node('span',`v${ext.version} · MV${ext.manifestVersion}`));
    const remove=node('button','卸载','danger');remove.onclick=async()=>{if(!window.confirm('从全部实例卸载此扩展？导入副本会保留。'))return;await call('extension-uninstall',{id:ext.id});await refresh();};top.append(remove);card.append(top,node('p',`权限：${ext.permissions.join(', ') || '未声明'}`,'hint'));
    for(const profile of state.profiles){
      const run=ext.profiles.find(item=>item.profileId===profile.id)||{}, row=node('div',undefined,'profile-extension'), label=node('label'), toggle=node('input');toggle.type='checkbox';toggle.checked=run.enabled;toggle.onchange=async()=>{toggle.disabled=true;await call('extension-toggle',{id:ext.id,profileId:profile.id,enabled:toggle.checked});await refresh();};
      label.append(toggle,node('span',` ${profile.name}`));row.append(label,node('span',`${({loaded:'已加载',disabled:'未启用',error:'加载失败',pending:'等待实例启动'})[run.status]||run.status}${run.error?': '+run.error:''}`,'status'));
      const popup=node('button','打开弹窗');popup.disabled=run.status!=='loaded';popup.onclick=()=>call('extension-popup',{id:ext.id,profileId:profile.id});
      const diagnose=node('button','诊断');diagnose.onclick=async()=>{const result=await call('extension-diagnose',{id:ext.id,profileId:profile.id});if(result){$('diagnostic').hidden=false;$('diagnostic').textContent=JSON.stringify(result,null,2);}};
      row.append(popup,diagnose);card.append(row);
    } return card;
  }));
  if(!state.extensions.length)$('extension-list').append(node('p','尚未导入扩展。','empty'));
}
function renderLogs() {
  $('log-list').replaceChildren(...state.logs.slice().reverse().map(entry=>{const details=node('details',undefined,'log-entry'); const profile=state.profiles.find(p=>p.id===entry.profileId);details.append(node('summary',`${new Date(entry.at).toLocaleString()} · ${entry.status} · ${entry.name||entry.kind} · ${profile?.name||entry.profileId||'全部实例'}`),node('pre',JSON.stringify(entry,null,2)));return details;}));
  if(!state.logs.length)$('log-list').append(node('p','暂无执行记录。','empty'));
}
async function refresh(){const next=await call('state');if(!next)return;const previous=state.profiles.map(p=>p.id).join(',');state=next;if(!initialized){initialized=true;edit(null);}else if(previous!==state.profiles.map(p=>p.id).join(',')){targets('script-targets',targetIds('script-targets'));}renderScripts();renderExtensions();renderLogs();}
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('active',item===button));document.querySelectorAll('.tab').forEach(tab=>tab.hidden=tab.id!==button.dataset.tab);});
$('new-script').onclick=()=>edit(null);
$('save-script').onclick=async()=>{const result=await call('save-script',{id:selected,name:$('script-name').value,code:$('script-code').value,trigger:$('script-trigger').value,enabled:$('script-enabled').checked,profileIds:targetIds('script-targets'),matches:$('script-matches').value.split('\n').map(value=>value.trim()).filter(Boolean)});if(result){await refresh();edit(result);message('脚本已保存；页面加载触发从下一次完整加载开始生效。');}};
$('run-script').onclick=async()=>{busy=true;renderScripts();const result=await call('run-script',{id:selected,profileIds:targetIds('script-targets')});busy=false;await refresh();if(result)message(`执行结束：${result.map(item=>item.status).join(' / ')}。详情见执行日志；未保存的编辑不会参与本次执行。`);};
$('delete-script').onclick=async()=>{if(!selected||!window.confirm('删除此脚本？'))return;const result=await call('delete-script',{id:selected});if(result){await refresh();edit(null);}};
$('import-script').onclick=async()=>{const script=await call('import-script',{profileIds:targetIds('script-targets')});if(script){await refresh();edit(script);message('脚本已导入，默认仅手动执行。');}};
$('import-extension').onclick=async()=>{const ext=await call('import-extension',{profileIds:targetIds('extension-targets')});if(ext){await refresh();message('扩展已导入。请检查各实例加载状态，并刷新已有页面验证注入。');}};
$('refresh-logs').onclick=refresh;
$('export-logs').onclick=async()=>{const file=await call('export-logs');if(file)message(`日志已保存：${file}`);};
let timer;api.onChanged(()=>{clearTimeout(timer);timer=setTimeout(refresh,100);});void refresh();
