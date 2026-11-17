var SiteUI=(()=>{
 'use strict';
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const aliases={medical:'stats',fit:'math'};
 let settings={name:'知镜',subtitle:'医学研究工作台',modules:[]};
 const filterOpen={};
 if(new URLSearchParams(location.search).get('preview')==='1'){
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,options)=>{if(typeof input==='string'&&(input.startsWith('/api/')||input.startsWith('/assets/anatomy/'))){const url=new URL(input,location.origin);url.searchParams.set('preview','1');input=url.href;}return originalFetch(input,options);};
 }
 const canonical=key=>aliases[key]||key;
 function allowed(key){return preview()||!settings.modules.some(m=>m.id===canonical(key)&&m.visible===false);}
 function preview(){return new URLSearchParams(location.search).get('preview')==='1'&&PersonalStore.user?.role==='owner';}
 function label(key,fallback){return settings.modules.find(m=>m.id===canonical(key))?.label||fallback;}
 function nav(keys){return keys.filter(allowed).sort((a,b)=>(settings.modules.find(m=>m.id===a)?.order??999)-(settings.modules.find(m=>m.id===b)?.order??999));}
 function apply(value){settings=value;const brand=document.querySelector('.brand b');if(brand)brand.textContent=settings.name;const sub=document.querySelector('.brand i');if(sub)sub.textContent=settings.subtitle;document.title=settings.name+' Cognispect｜医学文献与研究工作台';}
 async function load(){const response=await fetch('/api/site'+(new URLSearchParams(location.search).get('preview')==='1'?'?preview=1':''));if(!response.ok)throw Error('网站设置读取未完成');apply(await response.json());}
 function afterRender(){
  const main=document.querySelector('#main');if(!main)return;
  const issue=typeof LibraryUI!=='undefined'&&LibraryUI.serviceNotice();if(issue){const banner=document.createElement('section');banner.className='site-service-notice';banner.setAttribute('role','status');banner.innerHTML='<strong>在线服务暂不可用</strong><p>'+e(issue)+'</p><a class="btn" href="/demo/">继续使用公开演示版</a> <button class="btn ghost" onclick="location.reload()">重新连接</button>';main.prepend(banner);}
  if(settings.announcement){const banner=document.createElement('p');banner.className='site-announcement';banner.textContent=settings.announcement;main.prepend(banner);}
  if(preview()){const banner=document.createElement('p');banner.className='site-announcement';banner.innerHTML='站主预览：包含隐藏内容和未发布设置。 <a href="/admin">返回管理后台</a>';main.prepend(banner);}
  const pages=state.step==='stats'||state.step==='medical'?[['stats','常规统计与绘图'],['medical','患者随访与分析方案']]:state.step==='math'||state.step==='fit'?[['math','机制模型与模拟'],['fit','浓度数据拟合']]:state.step==='anatomy'||state.step==='intro'?[['intro','人体导览'],['anatomy','完整解剖图谱']]:[];
  if(pages.length){const tabs=document.createElement('div');tabs.className='workspace-tabs';tabs.innerHTML=pages.filter(([id])=>allowed(id)).map(([id,name])=>`<button class="btn ${id===state.step?'':'ghost'}" data-workspace-page="${id}" aria-current="${id===state.step?'page':'false'}">${name}</button>`).join('');main.querySelector('.work-head')?.after(tabs);tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>goto(b.dataset.workspacePage));}
  main.querySelectorAll('.upgrade-shortcuts').forEach(el=>el.remove());
  main.querySelectorAll('[data-filter-section]').forEach(el=>{if(filterOpen[el.dataset.filterSection]!==undefined)el.open=filterOpen[el.dataset.filterSection];el.ontoggle=()=>{filterOpen[el.dataset.filterSection]=el.open;};});
  main.querySelectorAll('[data-year-preset]').forEach(b=>b.onclick=()=>{const years=Number(b.dataset.yearPreset),end=new Date().getFullYear();SRCH.years=[];SRCH.yearFrom=years?end-years+1:0;SRCH.yearTo=years?end:0;SRCH.page=1;renderMain();});
  const apply=main.querySelector('#applyYearRange');if(apply)apply.onclick=()=>{const start=Number(document.querySelector('#yearRangeFrom').value)||0,end=Number(document.querySelector('#yearRangeTo').value)||0;if(start&&end&&start>end){document.querySelector('#yearRangeError').textContent='起始年份不能晚于结束年份';return;}Object.assign(SRCH,{years:[],yearFrom:start,yearTo:end,page:1});renderMain();};
  if(state.step==='intro'){const h=main.querySelector('.work-head h1'),p=main.querySelector('.work-head p');if(h&&settings.hero_title)h.textContent=settings.hero_title;if(p&&settings.hero_description)p.textContent=settings.hero_description;}
  if(state.step==='res'&&settings.resource_links?.length){const section=document.createElement('section');section.className='glass panel';section.innerHTML='<h2>站主推荐资源</h2>'+settings.resource_links.filter(r=>/^https?:\/\//.test(r.url)).map(r=>`<p><a href="${e(r.url)}" target="_blank" rel="noopener noreferrer">${e(r.label||r.url)}</a></p>`).join('');main.append(section);}
 }
 return {load,apply,allowed,label,nav,afterRender,get settings(){return settings;}};
})();
