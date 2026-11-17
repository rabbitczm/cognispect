var BackgroundTasks=(()=>{
 const queue=[];let active=null,timer=0,pausedUntil=0;
 function pump(){clearTimeout(timer);if(active||!queue.length||document.hidden)return;const delay=pausedUntil-performance.now();if(delay>0){timer=setTimeout(pump,delay);return;}const job=queue.shift(),controller=new AbortController();active={job,controller};Promise.resolve().then(()=>job.work(controller.signal)).then(job.resolve,error=>{if(error.name==='AbortError')queue.unshift(job);else job.reject(error);}).finally(()=>{active=null;timer=setTimeout(pump,40);});}
 function foreground(ms=800){pausedUntil=Math.max(pausedUntil,performance.now()+ms);active?.controller.abort();pump();}
 function run(work){return new Promise((resolve,reject)=>{queue.push({work,resolve,reject});pump();});}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)active?.controller.abort();else pump();});
 return {run,foreground};
})();
var PublicCache=(()=>{
 'use strict';
 let connection;
 async function db(){
  if(!connection)connection=new Promise((resolve,reject)=>{const r=indexedDB.open('zhijing-public-v21',1);r.onupgradeneeded=()=>r.result.createObjectStore('resources');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return connection;
 }
 async function use(mode,operation){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('resources',mode),r=operation(tx.objectStore('resources'));tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);});}
 async function get(key){try{return await use('readonly',s=>s.get(key));}catch{return null;}}
 async function put(key,value){try{await use('readwrite',s=>s.put(value,key));}catch{}}
 async function remove(key){try{await use('readwrite',s=>s.delete(key));}catch{}}
 async function clear(){try{await use('readwrite',s=>s.clear());}catch{}}
 const transfers=new Map();
 async function resource(url,version,options={}){
  const key='asset:'+url,cached=await get(key);if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');if(cached?.version===version)return cached.blob;
  const id=version+':'+url,priority=options.priority||'auto';let transfer=transfers.get(id);
  if(transfer?.priority==='low'&&priority!=='low')transfer.priority=priority;
  if(priority!=='low')BackgroundTasks.foreground();
  if(!transfer){const controller=new AbortController();transfer={controller,priority};const job=transfer;if(options.signal)options.signal.addEventListener('abort',()=>{if(job.priority==='low')controller.abort();},{once:true});
   job.promise=(async()=>{try{const response=await fetch(url,{priority,signal:controller.signal});if(!response.ok)throw Error('资源暂未加载完成');const blob=await response.blob();put(key,{version,blob});return blob;}finally{if(transfers.get(id)===job)transfers.delete(id);}})();transfers.set(id,job);
  }return transfer.promise;
 }
 return {get,put,remove,clear,resource};
})();

var LibraryUI=(()=>{
 'use strict';
 let version='',indexReady=false,complete=false,loading=false,started=false,notice='',background=null,epoch=0,observer=null,saveTimer,nextOffset=0,total=0,liveState=null,services=null,lastRefresh=0,foregroundTime=0;
 const preview=()=>new URLSearchParams(location.search).get('preview')==='1';
 const route=url=>url+(preview()?(url.includes('?')?'&':'?')+'preview=1':'');
 async function read(url,signal){const response=await fetch(route(url),{signal,priority:signal?'low':'high'});const value=await response.json();if(!response.ok){if(/^D1_|^DATABASE_/.test(value.code||'')){services={...services,database:{available:false,...value}};liveState=null;epoch++;LIB.splice(0);for(const map of [ABS,ZH,ZHSRC,DOCS,VERIFY])for(const key of Object.keys(map))delete map[key];ONLINE_DOCS.clear();CATALOG_SEARCH.docs=[];CATALOG_SEARCH.total=0;}throw Error(value.error||'文献暂未读取完成');}return value;}
 function merge(page){
  const existing=new Map(LIB.map(d=>[String(d.key),d]));
  for(const doc of page.docs||[]){const key=String(doc.key);if(existing.has(key))Object.assign(existing.get(key),doc);else{LIB.push(doc);existing.set(key,doc);}for(const alias of new Set([key,doc.pmid].filter(Boolean))){if(doc.abstract!==undefined)ABS[alias]=doc.abstract;if(doc.zh){ZH[alias]=doc.zh;ZHSRC[alias]=doc.translation_source||doc.abstract||'';}}}
  for(const [name,map]of [['abstracts',ABS],['translations',ZH],['translation_sources',ZHSRC],['focus',DOCS],['verify',VERIFY]])Object.assign(map,page[name]||{});
 }
 function snapshot(){return {version,docs:LIB,abstracts:ABS,translations:ZH,translation_sources:ZHSRC,focus:DOCS,verify:VERIFY,indexReady,complete,nextOffset,total};}
 async function save(){if(!preview()){await PublicCache.put('library',snapshot());localStorage.setItem('zhijing.library.version',version);}}
 function status(){return notice||(!complete?'当前页已就绪，空闲时缓存常用题录':'常用题录已缓存，其他文献在检索与翻页时读取');}
 function update(){
  const count=document.querySelector('#metaCount');if(count)count.textContent='可检索 '+(total||LIB.length).toLocaleString()+' 条';
  const s=document.querySelector('#libraryLoadStatus');if(s)s.textContent=status();
  const input=document.querySelector('#qInput');
  if(document.activeElement?.closest('#searchPageJump,#searchHistory'))return;
  if(state.step==='search'&&SRCH.scope!=='mine'&&document.activeElement===input&&input.dataset.composing!=='true'){
   const replacement=document.createElement('div');replacement.innerHTML=renderSearch();
   const old=document.querySelector('.sbody'),fresh=replacement.querySelector('.sbody');
   if(old&&fresh){old.replaceWith(fresh);bindSearch();bind();MyPapers.bind();FinalUI.bind();SiteUI.afterRender();}
   return;
  }
  if(state.step==='search'&&(!input||document.activeElement!==input)&&!document.querySelector('[open].account-dialog')){
   const main=document.querySelector('#main'),scroll=main.scrollTop;pageScroll.search=scroll;renderMain();main.scrollTop=scroll;
  }
 }
 async function first(){
  const cachedJob=!preview()?PublicCache.get('library'):Promise.resolve(null);
  let current=await (window.ZHIJING_BOOTSTRAP||read('/api/bootstrap'+(!preview()&&localStorage.getItem('zhijing.library.version')?'?version='+encodeURIComponent(localStorage.getItem('zhijing.library.version')):'')));
  const cached=await cachedJob;
  services=current.services||{database:{available:true}};liveState=current.public_state||null;
  if(!current.library&&services.database?.available===false){started=true;notice=services.database.error;return current;}
  if(!current.library&&(!cached?.docs?.length||cached.version!==current.version))current=await read('/api/bootstrap');
  version=current.version;SiteUI.apply(current.site);
  if(cached?.version===version&&cached.docs?.length){merge(cached);indexReady=!!cached.indexReady;complete=!!cached.complete;nextOffset=Number(cached.nextOffset)||0;total=cached.total||current.library?.total||cached.docs.length;}
  else{if(cached)await PublicCache.remove('library');const first=current.library;merge(first);total=first.total;nextOffset=first.next??first.total;complete=first.next==null;}
  started=true;lastRefresh=Date.now();save();return current;
 }
 async function rest(){
  if(loading||complete||state.step!=='search'||services?.database?.available===false)return background;
  loading=true;const current=epoch;
  background=(async()=>{
   try{
    indexReady=true;
    while(nextOffset<Math.min(total,2000)){
     const offset=nextOffset,limit=Math.min(100,100-offset%100,2000-offset);
     if(current!==epoch||state.step!=='search')return;
     await new Promise(resolve=>setTimeout(resolve,80));
     const page=await BackgroundTasks.run(signal=>read('/api/library?offset='+offset+'&limit='+limit,signal));if(current!==epoch)return;merge(page);nextOffset=page.next??page.total;await save();
    }
    complete=true;notice='';await save();update();
   }catch(error){notice='后台加载暂时中断，已有文献可以继续阅读；点击刷新重试。';update();}
   finally{loading=false;}
  })();return background;
 }
 async function ensure(key){
  const checked=await accessState();if(checked?.backend==='static'&&typeof PublicSearch!=='undefined'){const doc=await PublicSearch.document(key,checked);merge({docs:doc?[doc]:[]});await save();return doc;}
  if(ONLINE_DOCS.has(key)){merge({docs:[ONLINE_DOCS.get(key)]});return;}
  if(ABS[key]!==undefined&&LIB.some(d=>d.key===key))return;
  try{const page=await read('/api/library/document/'+encodeURIComponent(key));merge(page);await save();return page;}
  catch{const response=await fetch('/api/library/online/document/'+encodeURIComponent(key));const value=await response.json();if(!response.ok)throw Error(value.error||'文献暂未读取完成');const doc=normalizeOnlineRecord(value.record);ONLINE_DOCS.set(doc.key,doc);merge({docs:[doc]});if(doc.abstract)ABS[doc.key]=doc.abstract;return doc;}
 }
 async function refresh(){
  if(!started)return;
  if(Date.now()-lastRefresh<15000)return;
  lastRefresh=Date.now();
  notice='正在刷新…';update();
  try{
   const previous=version,checked=await accessState(),current=checked?.backend==='static'?checked:await read('/api/library/meta');
   if(current.version!==previous){
    epoch++;loading=false;complete=false;indexReady=false;version=current.version;
    LIB.splice(0);for(const map of [ABS,ZH,ZHSRC,DOCS,VERIFY])for(const key of Object.keys(map))delete map[key];
    await PublicCache.remove('library');const first=await read('/api/library?limit=20');merge(first);total=first.total;nextOffset=first.next??first.total;complete=first.next==null;CATALOG_SEARCH.signature='';CATALOG_SEARCH.docs=[];ONLINE_DOCS.clear();await save();await SiteUI.load();
   }
   notice='';update();rest();
  }catch(error){notice='刷新未完成，请检查网络后重试。';update();}
 }
 function bind(){
  document.querySelector('#libraryRefresh')?.addEventListener('click',refresh);
  const main=document.querySelector('#main');let start=null;
  main.ontouchstart=event=>{start=main.scrollTop===0?event.touches[0]?.clientY:null;};
  main.ontouchend=event=>{if(start!=null&&event.changedTouches[0]?.clientY-start>85)refresh();start=null;};
 }
 async function accessState(){
  if(!started)throw Error('文献正在准备，请稍候');
  if(liveState?.backend==='demo')return liveState;
  const current=await read('/api/library/state');
  if(current.backend==='static'){liveState=current;services={...services,database:{available:true}};if(version!==current.version){version=current.version;epoch++;complete=false;nextOffset=0;LIB.splice(0);for(const map of [ABS,ZH,ZHSRC,DOCS,VERIFY])for(const key of Object.keys(map))delete map[key];ONLINE_DOCS.clear();CATALOG_SEARCH.signature='';CATALOG_SEARCH.docs=[];await PublicCache.remove('library');}SiteUI.apply(current.site||SiteUI.settings);}
  return current;
 }
 function serviceNotice(){return services?.database?.available===false?services.database.error:'';}
 window.addEventListener('focus',()=>{if(started&&Date.now()-foregroundTime>60000){foregroundTime=Date.now();refresh();}});
 return {first,rest,ensure,refresh,merge,bind,status,accessState,serviceNotice,get started(){return started;},get services(){return services;},get publicState(){return liveState;},get version(){return version;},get indexReady(){return indexReady;},get complete(){return complete;}};
})();

var AnatomyLoader=(()=>{
 let job,prefetched=false;
 function script(url,priority){return new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src=url;tag.fetchPriority=priority;tag.onload=resolve;tag.onerror=()=>reject(Error('人体图谱加载未完成，请重试'));document.head.append(tag);});}
 function ensure(background=false){if(window.AnatomyRuntimeReady&&window.THREE)return Promise.resolve();if(!job){const assets=window.ZHIJING_ASSETS||{},priority=background?'low':'high';const runtime=window.AnatomyRuntimeReady?Promise.resolve():script(assets.atlas||'/assets/anatomy-runtime.js?v=24',priority);const three=window.THREE?Promise.resolve():script(assets.three||'/assets/three.min.js',priority);job=Promise.all([three,runtime.then(()=>background?null:AnatomyModel.catalog(localStorage.getItem('zhijing.atlas.model')||'male'))]).catch(error=>{job=null;throw error;});}return job;}
 async function prefetch(){
  if(prefetched||navigator.connection?.saveData||/2g/.test(navigator.connection?.effectiveType||'')||!SiteUI.allowed('anatomy'))return;
  prefetched=true;
  const idle=window.requestIdleCallback||((fn)=>setTimeout(fn,1200));
  idle(async()=>{try{await ensure(true);await AnatomyModel.prefetch();}catch{}},{timeout:5000});
 }
 return {ensure,prefetch};
})();
var AnatomyUI={render:()=>'<section class="wrap work-head"><h1>人体图谱</h1><p role="status">正在准备交互图谱，其他功能可以继续使用。</p></section>',bind:()=>AnatomyLoader.ensure().then(()=>{if(state.step==='anatomy')renderMain();}).catch(error=>{const p=document.querySelector('.work-head p');if(p){p.textContent=error.message;const b=document.createElement('button');b.className='btn';b.textContent='重试';b.onclick=()=>AnatomyUI.bind();p.after(b);}}),dispose:()=>{}};
