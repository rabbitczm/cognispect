var MyPapers=(()=>{
 let documents=[],submissions=[],loadedFor='',busy=false,error='',query='',year='',review='';
 const e=value=>esc(String(value??'')),labels={draft:'草稿',pending:'待审核',approved:'已公开',returned:'需修改'};
 function tabs(){return `<div class="library-tabs" role="tablist" aria-label="文献范围"><button role="tab" data-library-scope="all" aria-selected="${SRCH.scope!=='mine'}">全部文献</button><button role="tab" data-library-scope="mine" aria-selected="${SRCH.scope==='mine'}">我的文献</button></div>`;}
 function render(){
  const user=PersonalStore.user;
  const records=documents.map(d=>({...d,submission:submissions.find(s=>s.pdf_id===d.id)})).filter(d=>{
   const hay=[d.title,d.name,d.author,d.doi].join(' ').toLowerCase();
   return hay.includes(query.toLowerCase())&&(!year||String(d.year||'')===year)&&(!review||(d.submission?.status||'private')===review);
  });
  return `<div class="wrap wide search-workspace"><div class="data-summary"><div><div class="overline">个人资料库</div><h1>我的文献</h1></div><button class="btn" id="myUpload">上传 PDF</button></div>${tabs()}${!user?'<section class="empty"><h2>登录后管理自己的论文</h2><p>上传的文件默认仅自己可见，可以申请审核后公开。</p><button class="btn" id="myLogin">登录 / 注册</button></section>':`<div class="my-paper-filters"><label>搜索我的论文<input id="myPaperQuery" value="${e(query)}" placeholder="标题、作者、文件名或 DOI"></label><label>年份<input id="myPaperYear" inputmode="numeric" value="${e(year)}" placeholder="全部年份"></label><label>状态<select id="myPaperStatus">${[['','全部状态'],['private','仅自己可见'],['draft','投稿草稿'],['pending','待审核'],['approved','已公开'],['returned','需修改']].map(([v,n])=>`<option value="${v}" ${review===v?'selected':''}>${n}</option>`).join('')}</select></label><button class="btn ghost" id="myPaperRefresh">刷新</button></div><p role="status">${e(error||((busy||loadedFor!==user.id)?'正在读取私人文献…':records.length+' 篇私人文献'))}</p><div id="myPaperResults">${records.map(d=>`<article class="hit"><button class="hit-t textlink" data-my-pdf="${e(d.id)}">${e(d.title||d.name)}</button><p class="hit-m">${e(d.author||'作者待填写')} · ${e(d.year||'年份待填写')}${d.doi?' · DOI '+e(d.doi):''}</p><div class="my-paper-actions"><span class="tag">${labels[d.submission?.status]||'仅自己可见'}</span><button class="textlink" data-my-pdf="${e(d.id)}">打开阅读</button><button class="textlink" data-my-publish="${e(d.id)}">${d.submission?'查看申请':'申请公开'}</button></div>${d.submission?.review_note?`<p>审核意见：${e(d.submission.review_note)}</p>`:''}</article>`).join('')||(!busy&&loadedFor===user.id?'<section class="empty"><h2>还没有匹配的论文</h2><p>上传 PDF，或更换搜索词与筛选条件。</p></section>':'')}</div>`}</div>`;
 }
 async function load(){if(!PersonalStore.user||busy)return;busy=true;error='';const id=PersonalStore.user.id;try{const [pdfs,items]=await Promise.all([PersonalStore.request('/api/pdfs'),PersonalStore.request('/api/submissions')]);if(PersonalStore.user?.id!==id)return;documents=pdfs.documents;submissions=items.records;loadedFor=id;}catch(err){error=err.message;}finally{busy=false;if(state.step==='search'&&SRCH.scope==='mine')renderMain();}}
 function bind(){
  document.querySelectorAll('[data-library-scope]').forEach(b=>b.onclick=()=>{SRCH.scope=b.dataset.libraryScope;SRCH.page=1;renderMain();if(SRCH.scope==='mine')load();});
  if(SRCH.scope!=='mine')return;
  if(PersonalStore.user&&loadedFor!==PersonalStore.user.id&&!busy)load();
  document.querySelector('#myLogin')?.addEventListener('click',()=>WebAccount.open());
  document.querySelector('#myUpload')?.addEventListener('click',()=>{if(WebAccount.requireLogin()){goto('pdf');document.querySelector('#pdfFile')?.click();}});
  document.querySelector('#myPaperRefresh')?.addEventListener('click',load);
  for(const [id,set]of [['myPaperQuery',v=>query=v],['myPaperYear',v=>year=v],['myPaperStatus',v=>review=v]]){
   const input=document.getElementById(id);if(!input)continue;
   input.onchange=()=>{set(input.value);renderMain();};
   if(id==='myPaperQuery'){let timer;input.oninput=ev=>{if(ev.isComposing)return;clearTimeout(timer);timer=setTimeout(()=>{const pos=input.selectionStart;set(input.value);renderMain();const next=document.getElementById(id);next.focus();next.setSelectionRange(pos,pos);},250);};input.addEventListener('compositionend',()=>input.dispatchEvent(new Event('input')));}
  }
  document.querySelectorAll('[data-my-pdf]').forEach(b=>b.onclick=()=>PdfUI.open(b.dataset.myPdf));
  document.querySelectorAll('[data-my-publish]').forEach(b=>b.onclick=()=>{const pdf=documents.find(d=>d.id===b.dataset.myPublish),item=submissions.find(s=>s.pdf_id===pdf.id);goto('papers');UpgradeUI.startSubmission(pdf,item);});
 }
 return {render,tabs,bind,load};
})();
