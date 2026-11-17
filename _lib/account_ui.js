var PersonalStore=(()=>{
 'use strict';
 const names=new Set(['helix.notes.v9','helix.reviews.v16','helix.review.v12','helix.review.active.v16','helix.clips.v2','helix.clip.v1','helix.search.history.v25','helix.search.saved.v25','helix.pdf.notes','helix.api.v14','helix.api.profiles.v17','helix.stats.draft.v17','helix.stats.result.v17','helix.math.draft.v17','helix.analysis.templates.v18','helix.medical.draft.v18','helix.pk.fit.v18']);
 let data={},revision=0,user=null,ready=false,dirty=false,timer=null,inflight=null,conflict=null,status='正在连接…';
 const allowed=k=>names.has(k)||k.startsWith('helix.translation.');
 const cacheKey=()=>user?'helix.pending.'+user.id:'';
 const announce=()=>document.dispatchEvent(new CustomEvent('workspace-status'));
 const pending=()=>{if(user)localStorage.setItem(cacheKey(),JSON.stringify({revision,data}));};
 async function request(url,options={}){const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});const value=await response.json();if(!response.ok){const error=Error(value.error||value.detail||'请求未完成');error.status=response.status;error.value=value;throw error;}return value;}
 function getItem(k){return data[k]??null;}
 function setItem(k,v){if(!user||!allowed(k))return;const value=String(v);if(data[k]===value)return;data[k]=value;dirty=true;status='正在保存…';pending();announce();clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),450);}
 async function flush(){
  clearTimeout(timer);if(inflight){await inflight;if(dirty&&!conflict)return flush();return;}if(!user||!dirty||conflict)return;
  const sent={...data};
  inflight=request('/api/workspace',{method:'PUT',body:JSON.stringify({user_id:user.id,revision,data:sent})}).then(value=>{
   revision=value.revision;dirty=JSON.stringify(data)!==JSON.stringify(sent);status=dirty?'正在保存…':'已同步';if(dirty)pending();else localStorage.removeItem(cacheKey());
  }).catch(error=>{if(error.value?.code==='ACCOUNT_CHANGED'){status='账号已切换，请重新登录';pending();location.reload();}else if(error.status===409){conflict=error.value;status='有另一份修改，点击处理';}else{status='尚未同步，点击重试';}pending();throw error;}).finally(()=>{inflight=null;announce();});
  await inflight;if(dirty&&!conflict)return flush();
 }
 async function init(initialSession){
  if(initialSession?.unavailable){user=null;ready=true;status='账号服务暂未连接';announce();return initialSession;}
  try{const session=initialSession||await request('/api/auth/session');user=session.authenticated?session.user:null;if(user){const remote=await request('/api/workspace');data=remote.data;revision=remote.revision;status='已同步';const stored=localStorage.getItem(cacheKey());if(stored){const draft=JSON.parse(stored);data=draft.data;dirty=true;if(draft.revision===revision)await flush();else{conflict=remote;status='有未同步笔记，点击处理';}}}else{data={};status='登录保存个人资料';}return session;}
  catch(error){status='个人工作区未同步，点击重试';throw error;}
  finally{ready=true;announce();}
 }
 async function resolve(useLocal){const remote=conflict;conflict=null;revision=remote.revision;if(useLocal){dirty=true;await flush();}else{data=remote.data;dirty=false;localStorage.removeItem(cacheKey());location.reload();}}
 function download(value,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function backup(){download({format:'helix-workspace-v17',data,exported:new Date().toISOString()},'知镜-个人研究备份.json');}
 function importData(value){
  const incoming=value.format==='helix-workspace-v17'?value.data:value.localStorage||value.data||value;
  let entries={};
  if(value.paper&&('note' in value||'memo' in value)){
   const paperKey=String(value.paper.pmid||value.paper.id||value.paper.key||'');if(!paperKey)throw Error('文件缺少文献编号');
   const key='memo' in value?'helix.reviews.v16':'helix.notes.v9';const previous=JSON.parse(getItem(key)||'{}');previous[paperKey]='memo' in value?value:{note:value.note||'',highlights:value.highlights||[]};entries[key]=JSON.stringify(previous);
  }else for(const [key,raw]of Object.entries(incoming)){if(!allowed(key))continue;let text=typeof raw==='string'?raw:JSON.stringify(raw);if(key==='helix.api.v14'){const cfg=JSON.parse(text);delete cfg.key;delete cfg.fallbackKey;text=JSON.stringify(cfg);}entries[key]=text;}
  if(!Object.keys(entries).length)throw Error('未找到可导入的笔记、复盘或工作区数据');
  for(const [key,value]of Object.entries(entries)){if(['helix.notes.v9','helix.reviews.v16'].includes(key)){const current=JSON.parse(getItem(key)||'{}');setItem(key,JSON.stringify({...JSON.parse(value),...current}));}else setItem(key,value);}return Object.keys(entries).length;
 }
 window.addEventListener('pagehide',()=>{if(dirty)pending();});
 return {getItem,setItem,init,flush,request,backup,importData,resolve,get user(){return user;},get ready(){return ready;},get status(){return status;},get conflict(){return conflict;},get dirty(){return dirty;}};
})();

var WebAccount=(()=>{
 'use strict';
 const e=value=>esc(String(value??'')),$=s=>document.querySelector(s),publicPages=new Set(['intro','search','reader','res','anatomy','papers']);
 const cloud=window.ZHIJING_RUNTIME==='cloud';
 let smtp=false;
 function requireLogin(){if(PersonalStore.user)return true;open();return false;}
 function header(){const button=$('#accountButton'),status=$('#workspaceStatus');if(button)button.textContent=PersonalStore.user?'我的工作区':'登录 / 注册';if(status)status.textContent=PersonalStore.status;const admin=$('#adminLink');if(admin)admin.hidden=!['owner','admin','editor'].includes(PersonalStore.user?.role);}
 function dialog(content){document.querySelector('#accountDialog')?.remove();const d=document.createElement('dialog');d.id='accountDialog';d.className='account-dialog';d.innerHTML=`<div class="account-dialog-head"><span>知镜 / 个人研究空间</span><button class="textlink" data-account-close aria-label="关闭">关闭</button></div>${content}`;document.body.append(d);d.querySelector('[data-account-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.showModal();return d;}
 function open(mode='login',token=''){
  if(PersonalStore.user&&mode==='login')return profile();
  const titles={login:'账号登录',register:'创建研究账号',forgot:'使用恢复码重置密码',reset:'设置新密码'};
  const invite=new URLSearchParams(location.search).get('invite')||'';
  const d=dialog(`<h2>${titles[mode]}</h2>${mode==='login'||mode==='register'?`<div class="account-tabs"><button data-auth-mode="login" aria-pressed="${mode==='login'}">登录</button><button data-auth-mode="register" aria-pressed="${mode==='register'}">注册</button></div>`:''}<form id="accountForm">${mode!=='reset'?`<label>账号<input name="username" autocomplete="username" required></label>`:''}${mode==='register'&&!cloud?`<label>测试邀请码<input name="invite" value="${e(invite)}" autocomplete="off" ${invite?'readonly':''} required></label>`:''}${mode==='forgot'?'<label>恢复码<input name="recovery_code" autocomplete="off" required></label>':''}${mode!=='reset'?'<label>密码<input name="password" type="password" autocomplete="'+(mode==='login'?'current-password':'new-password')+'" minlength="8" required></label>':''}<button class="btn" type="submit">${{login:'登录',register:'创建账号',forgot:'重置密码',reset:'更新密码'}[mode]}</button><p id="accountMessage" role="status"></p></form>${mode==='login'?'<button class="textlink" data-auth-mode="forgot">忘记密码</button>':''}`);
  d.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>open(b.dataset.authMode));
  d.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const form=ev.target,button=form.querySelector('[type=submit]'),message=$('#accountMessage');button.disabled=true;message.textContent='正在提交…';try{const params=Object.fromEntries(new FormData(form));let result;if(mode==='forgot'){result=await PersonalStore.request('/api/auth/reset-password',{method:'POST',body:JSON.stringify(params)});message.innerHTML=`密码已重置。请立即保存新的恢复码：<code>${e(result.recovery_code)}</code>`;button.type='button';button.textContent='完成';button.onclick=()=>location.reload();return;}const route=mode==='register'?'register':'login';params.remember=true;result=await PersonalStore.request('/api/auth/'+route,{method:'POST',body:JSON.stringify(params)});if(result.recovery_code){message.innerHTML=`账号已创建。请先保存恢复码：<code>${e(result.recovery_code)}</code>`;button.type='button';button.textContent='完成';button.onclick=()=>location.reload();return;}if(result.authenticated){new BroadcastChannel('helix-account').postMessage('login');location.reload();return;}message.textContent=result.message||'操作已完成。';}catch(err){message.textContent=err.message;}finally{button.disabled=false;}};
 }
 function profile(){
  const user=PersonalStore.user,d=dialog(`<h2>我的工作区</h2><p class="account-email">${e(user.username||'')}</p><div class="account-sync-row"><span>${e(PersonalStore.status)}</span><button class="textlink" id="accountRetry">立即同步</button></div><div class="account-data-actions"><button class="btn ghost" id="accountExport">导出全部笔记与设置</button><label class="btn ghost">导入旧版备份<input id="accountImport" type="file" accept=".json,application/json" hidden></label></div><form id="passwordChange" class="account-password-change"><label>当前密码<input name="current_password" type="password" autocomplete="current-password" required></label><label>新密码<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn ghost">修改密码并更新恢复码</button></form><p id="accountMessage" role="status"></p><button class="btn" id="accountLogout">退出登录</button>`);
  d.querySelector('#accountExport').onclick=()=>PersonalStore.backup();
  d.querySelector('#accountRetry').onclick=async()=>{if(PersonalStore.conflict)return resolveConflict();try{await PersonalStore.flush();profile();}catch(err){$('#accountMessage').textContent=err.message;}};
  d.querySelector('#accountImport').onchange=async ev=>{try{PersonalStore.importData(JSON.parse(await ev.target.files[0].text()));await PersonalStore.flush();if(!PersonalStore.conflict)location.reload();else resolveConflict();}catch(err){$('#accountMessage').textContent=err.message;}};
  d.querySelector('#passwordChange').onsubmit=async ev=>{ev.preventDefault();const form=ev.target,button=form.querySelector('button');button.disabled=true;try{const result=await PersonalStore.request('/api/auth/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});$('#accountMessage').innerHTML=`密码已更新。请保存新的恢复码：<code>${e(result.recovery_code)}</code>`;form.reset();}catch(err){$('#accountMessage').textContent=err.message;}finally{button.disabled=false;}};
  d.querySelector('#accountLogout').onclick=async()=>{try{await PersonalStore.flush();if(PersonalStore.conflict)return resolveConflict();await PersonalStore.request('/api/auth/logout',{method:'POST',body:'{}'});await BrowserPdf.clearPrivate();new BroadcastChannel('helix-account').postMessage('logout');location.href=location.pathname;}catch(err){$('#accountMessage').textContent=err.message+'；可以先导出备份。';}};
 }
 function resolveConflict(){const d=dialog('<h2>选择保留的工作区</h2><p>另一台设备也保存了修改。可以先导出当前内容，再选择要继续使用的版本。</p><div class="account-data-actions"><button class="btn ghost" id="conflictExport">导出当前内容</button><button class="btn ghost" id="conflictRemote">读取云端版本</button><button class="btn" id="conflictLocal">用当前内容更新云端</button></div><p id="accountMessage" role="status"></p>');$('#conflictExport').onclick=()=>PersonalStore.backup();for(const [id,local]of [['conflictRemote',false],['conflictLocal',true]])d.querySelector('#'+id).onclick=async()=>{try{await PersonalStore.resolve(local);location.reload();}catch(err){$('#accountMessage').textContent=err.message;}};}
 function allowedPage(key){return (cloud&&['stats','medical','fit','math','lab','assist','models','pdf'].includes(key))||publicPages.has(key)||Boolean(PersonalStore.user);}
 function gate(){return '<section class="account-gate glass"><span class="overline">个人研究工作区</span><h1>登录后继续研究</h1><p>保存笔记、导入 PDF，整理你的分析与论文复盘。</p><button class="btn" id="accountGateLogin">登录 / 注册</button></section>';}
 function bind(){
  $('#accountGateLogin')?.addEventListener('click',()=>open());
  if(PersonalStore.user&&state.step==='stats'){ResearchUI.saveWorkspace();document.querySelectorAll('#statsCsv,#statsMode,#statsDataKind,#statsOrdered,#statsRobustness').forEach(el=>{el.addEventListener('input',()=>ResearchUI.saveWorkspace());el.addEventListener('change',()=>ResearchUI.saveWorkspace());});}
 }
 async function init(initialSession){
  const signal=new BroadcastChannel('helix-account');signal.onmessage=()=>location.reload();window.addEventListener('beforeunload',()=>signal.close());
  $('#accountButton').onclick=()=>open();$('#workspaceStatus').onclick=()=>PersonalStore.conflict?resolveConflict():open();document.addEventListener('workspace-status',header);
  try{const session=await PersonalStore.init(initialSession);smtp=session.smtp_configured;SRCH.cats=loadCats();ApiModels.reload();ResearchUI.restoreWorkspace();SimulationUI.restoreWorkspace();if(session.authenticated){renderNav();renderMain();}
   const params=new URLSearchParams(location.search),invite=params.get('invite');if(invite)open('register');
  }catch(err){const status=$('#workspaceStatus');if(status)status.textContent='个人工作区未同步，点击重试';}header();
 }
 return {init,bind,open,requireLogin,allowedPage,gate};
})();
