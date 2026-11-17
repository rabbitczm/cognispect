const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const{ProxyAgent,fetch}=require('D:/workspace/codex_list/tools/helix-wrangler/node_modules/undici');
const base=process.env.ZHIJING_V25_URL||'https://cognispect.tech',out='D:/workspace/codex_list/output/zhijing-v25';
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('_lib/aiq.js','utf8')+';globalThis.api=AIQ;',context);
const groups=q=>context.api.aiQuery(context.api.aiParse(q)).groups;
(async()=>{
 const agent=new ProxyAgent({uri:'http://127.0.0.1:7890',requestTls:{maxVersion:'TLSv1.2'}}),checks=[];
 async function request(path,body){
  const start=Date.now();const response=await fetch(base+path,{dispatcher:agent,method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  assert.equal(response.status,200,path);const value=path==='/'?await response.text():await response.json();
  checks.push({path,ms:Date.now()-start,total:value.total||value.hit_count,rows:value.docs?.length||value.records?.length});return value;
 }
 try{
  const html=await request('/');assert.match(html,/知镜 Cognispect/);assert.match(html,/app-\w+\.js/);
  const en=await request('/api/library/search',{groups:groups('diabetic nephropathy')}),zh=await request('/api/library/search',{groups:groups('糖尿病肾病')});
  assert.deepEqual(en.docs.map(d=>d.key),zh.docs.map(d=>d.key));assert.match(en.docs[0].title,/kidney|renal|nephropath/i);
  const h=await request('/api/library/search',{groups:groups('高血压')});assert.match(h.docs[0].title,/hypertension/i);assert.doesNotMatch(h.docs[0].title,/pulmonary|portal/i);
  const year=await request('/api/library/search',{groups:groups('糖尿病肾病'),yearFrom:2024,yearTo:2026,sort:'year'});const dates=year.docs.map(d=>d.firstdate||String(d.year));assert.deepEqual(dates,[...dates].sort().reverse());assert.ok(dates.every(d=>d>='2024'&&d<='2026-12-31'));
  const page=await request('/api/library/search',{page:110,limit:20});assert.equal(page.docs.length,20);assert.equal(new Set(page.docs.map(d=>d.pmid||d.doi||d.key)).size,20);
  const online=await request('/api/library/online',{groups:groups('糖尿病肾病'),sort:'year'});assert.equal(online.records.length,20);assert.ok(online.hit_count>1000);assert.ok(online.records.every(d=>d.source==='MED'));
  const report={base,checkedAt:new Date().toISOString(),checks,errors:[],note:'请求耗时包含验收电脑到代理的网络链路，不代表全部访客速度。'};
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/'+(base.includes('pages.dev')?'preview':'public')+'-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await agent.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
