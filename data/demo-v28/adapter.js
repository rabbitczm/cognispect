(()=>{
 'use strict';
 window.ZHIJING_DEMO=true;
 const nativeFetch=window.fetch.bind(window),version='competition-demo-v28',source=nativeFetch('/demo/library.json').then(r=>r.json());
 const json=(body,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}));
 const session={authenticated:false,user:null,auth_mode:'password',configured:false,smtp_configured:false};
 const normalize=v=>String(v||'').normalize('NFKC').toLowerCase();
 const match=(text,term)=>{text=normalize(text);term=normalize(term);if(/[\u3400-\u9fff]/.test(term))return text.includes(term);return new RegExp('(?:^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+')+'(?:$|[^a-z0-9])','i').test(text);};
 const state=data=>({version,base_version:version,backend:'demo',verified:true,base_url:'/demo/',hidden:[],removed:[],upserts:[],modules:data.site.modules,site:data.site});
 function page(data,rows,offset=0,limit=20){const docs=rows.slice(offset,offset+limit),keys=new Set(docs.map(d=>String(d.key)));return {version,docs,abstracts:Object.fromEntries(docs.map(d=>[d.key,d.abstract||''])),translations:Object.fromEntries(docs.filter(d=>d.zh).map(d=>[d.key,d.zh])),translation_sources:{},focus:{},verify:Object.fromEntries(docs.map(d=>[d.key,{source:'Europe PMC',checked_on:data.reviewedOn}])),sources:[],total:rows.length,next:offset+docs.length<rows.length?offset+docs.length:null};}
 function search(data,input){const field=['title','authors','journal'].includes(input.field)?input.field:null,terms=(input.groups||[]).flat();let rows=data.docs.filter(d=>!d.date_pending&&(input.groups||[]).every(group=>group.some(term=>match(field?d[field]:[d.title,d.authors,d.abstract,(d.mesh||[]).join?.(' ')||d.mesh].join(' '),term))));const date=d=>input.dateBasis==='issue'?String(d.year):String(d.firstdate||d.year),year=d=>Number(date(d).slice(0,4));rows=rows.filter(d=>(!input.yearFrom||year(d)>=input.yearFrom)&&(!input.yearTo||year(d)<=input.yearTo)&&(!input.oa||d.oa)&&(!input.onlyV||d.level>=3)&&(!input.hasAbstract||d.abstract)&&(!input.zhOnly||d.zh)&&(!input.years?.length||input.years.includes(year(d)))&&(!input.journals?.length||input.journals.includes(d.journal))&&(!input.topics?.length||input.topics.some(t=>d.topics?.includes(t)))&&!(input.exclude||[]).some(t=>match([d.title,d.authors,d.journal].join(' '),t)));
 rows.sort((a,b)=>{if(input.sort==='title')return a.title.localeCompare(b.title)||String(a.key).localeCompare(String(b.key));if(input.sort==='cite')return (b.cited||0)-(a.cited||0)||date(b).localeCompare(date(a));if(input.sort==='oldest')return date(a).localeCompare(date(b));if(input.sort!=='year'){const rank=d=>terms.filter(t=>match(d.title,t)).length,delta=rank(b)-rank(a);if(delta)return delta;}return date(b).localeCompare(date(a))||String(a.key).localeCompare(String(b.key));});const limit=Number(input.limit)||20,p=Number(input.page)||1;return {...page(data,rows,(p-1)*limit,limit),page:p,limit,pages:Math.ceil(rows.length/limit)};}
 window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(url.origin!==location.origin)return nativeFetch(input,options);if(url.pathname.startsWith('/assets/anatomy/')){url.pathname='/demo'+url.pathname;return nativeFetch(url,options);}if(!url.pathname.startsWith('/api/'))return nativeFetch(input,options);
 const data=await source,p=url.pathname,method=options.method||input.method||'GET';
 if(p==='/api/bootstrap'){const first=page(data,data.docs);return json({version,site:data.site,session,library:first,public_state:state(data),services:{public:{available:true},account:{available:false,message:'演示版不连接账号服务'},database:{available:false},ai:{available:false}},demo:true});}
 if(p==='/api/site')return json(data.site);
 if(['/api/library/state','/api/library/public-state','/api/public-state'].includes(p))return json(state(data));
 if(p==='/api/library/meta')return json({version,backend:'demo',...state(data)});
 if(p==='/api/auth/session'||p==='/api/admin/session')return json(session);
 if(p==='/api/library/search')return json(search(data,JSON.parse(options.body||'{}')));
 if(p==='/api/library')return json(page(data,data.docs,Number(url.searchParams.get('offset'))||0,Number(url.searchParams.get('limit'))||20));
 if(p==='/api/library/index')return json({version,docs:data.docs,total:data.docs.length});
 if(p.startsWith('/api/library/document/')){const key=decodeURIComponent(p.split('/').at(-1)),doc=data.docs.find(d=>[d.key,d.pmid,d.doi].some(v=>String(v)===key));return doc?json(page(data,[doc],0,1)):json({error:'这篇文献不在固定演示资料中，请回主站查看。'},404);}
 if(p==='/api/catalog')return json({upserts:[],removed:[]});
 if(p==='/api/public/submissions')return json({records:[]});
 if(p.startsWith('/api/guides/'))return json({guide:null,status:'pending',message:'本演示资料未收录独立讲解。'});
 if(p.startsWith('/api/publications/'))return json({error:'演示版提供原文链接；公开全文请回主站查看。'},404);
 if(p==='/api/summaries'&&method==='GET')return json({summary:null});
 if(p==='/api/translation/status')return json({configured:false,provider:'离线演示示例',model:'saved-example',version,glossary_version:'medical-2026-11-17'});
 if(p==='/api/search')return json({records:search(data,JSON.parse(options.body||'{}')).docs});
 return json({error:'当前是离线演示版。实时登录、上传、审批、云端保存和新 AI 请求请返回主站；已有示例可在“AI 演示示例”中查看。',code:'DEMO_READ_ONLY'},503);
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const show=async()=>{document.querySelector('#demoExampleDialog')?.remove();const data=await source,d=document.createElement('dialog');d.id='demoExampleDialog';d.innerHTML='<div class="demo-dialog-head"><h2>AI 医学翻译 · 演示示例</h2><button id="demoExampleClose" class="btn ghost">关闭</button></div><p>以下为此前真实 Cloudflare AI 验收保存的结果，当前没有发起新的 AI 请求。</p>'+data.examples.map(row=>'<article><h3>'+escape(row.label||row.id)+'</h3><p><b>上下文：</b>'+escape(row.context)+'</p><p><b>原文：</b>'+escape(row.text)+'</p><p><b>已保存译文：</b>'+escape(row.translation)+'</p></article>').join('');document.body.append(d);d.querySelector('#demoExampleClose').onclick=()=>d.close();d.showModal();};
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notice=()=>{if(document.querySelector('#demoNotice'))return;const main=document.querySelector('#main');if(!main)return;const bar=document.createElement('aside');bar.id='demoNotice';bar.innerHTML='<div><strong>离线演示版</strong><span>公开固定资料 · 本地计算 · 实时账号与上传请回主站</span></div><div><button id="demoExamplesButton" class="btn ghost tiny">AI 演示示例</button><a class="btn ghost tiny" href="https://cognispect.tech/" target="_blank" rel="noopener">主站 ↗</a></div>';main.prepend(bar);bar.querySelector('#demoExamplesButton').onclick=show;};
  const original=SiteUI.afterRender;SiteUI.afterRender=()=>{original();notice();};notice();
  const account=document.querySelector('#accountButton');if(account){const label=()=>{if(account.textContent!=='返回主站登录')account.textContent='返回主站登录';};label();new MutationObserver(label).observe(account,{childList:true,subtree:true});account.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();window.open('https://cognispect.tech/','_blank','noopener');},true);}document.querySelector('#workspaceStatus')?.setAttribute('hidden','');
  window.ZHIJING_DEMO_READY=true;
 });
})();
