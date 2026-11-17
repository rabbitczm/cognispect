import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import zlib from 'node:zlib';
import vm from 'node:vm';
import worker from '../cloud/worker.js';
const require=createRequire(import.meta.url),{Miniflare}=require('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare');
const root='D:/workspace/codex_list/code/zhijing',site=root+'/scratch/cloud-site',output='D:/workspace/codex_list/output/zhijing-v28';
const searchContext=vm.createContext({TextEncoder,atob});vm.runInContext(await fs.readFile(root+'/_lib/public_search_worker.js','utf8'),searchContext);
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-06',d1Databases:['DB']});
try{
 const db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir(root+'/cloud/migrations')).filter(n=>n.endsWith('.sql')).sort()){
  let statement='',trigger=false;for(const line of (await fs.readFile(root+'/cloud/migrations/'+name,'utf8')).split(/\r?\n/)){statement+=line+'\n';if(/\bBEGIN\s*$/i.test(line))trigger=true;if(/\bEND;\s*$/i.test(line))trigger=false;if(/;\s*$/.test(line)&&!trigger){await db.prepare(statement.trim()).run();statement='';}}
 }
 const queries=[];
 const tracked={prepare(q){const wrap=s=>({bind(...args){return wrap(s.bind(...args))},async all(){const r=await s.all();queries.push({query:q,read:r.meta.rows_read,written:r.meta.rows_written});return r},async first(col){const r=await this.all();return col?r.results[0]?.[col]??null:r.results[0]??null},async run(){const r=await s.run();queries.push({query:q,read:r.meta.rows_read,written:r.meta.rows_written});return r},_raw:s});return wrap(db.prepare(q));},batch(stmts){return db.batch(stmts.map(s=>s._raw))}};
 const ASSETS={async fetch(request){const p=path.join(site,new URL(request.url).pathname);try{const raw=await fs.readFile(p),match=request.headers.get('range')?.match(/^bytes=(\d+)-(\d+)$/);if(match){const a=+match[1],b=+match[2];return new Response(raw.subarray(a,b+1),{status:206,headers:{'content-range':`bytes ${a}-${b}/${raw.length}`}})}return new Response(raw);}catch{return new Response('missing',{status:404})}}};
 const env={DB:tracked,ASSETS},get=(p,init={})=>worker.fetch(new Request('https://test.local'+p,init),env);
 const json=async p=>{const r=await get(p);assert.equal(r.status,200,await r.clone().text());return r.json()};
 const start=queries.length,bootstrap=await json('/api/bootstrap');assert.equal(bootstrap.library.docs.length,20);assert.equal(bootstrap.public_state.backend,'static');assert.equal(bootstrap.session.authenticated,false);const startup=queries.slice(start);
 const batches=[];for(let i=0;i<10;i++){const n=queries.length;await json('/api/library/state');batches.push(queries.slice(n))}
 for(let i=0;i<20;i++)await json('/api/library?offset='+i*20+'&limit=20');
 assert.ok(queries.every(q=>!q.query.includes('literature_search')),'public browsing must never scan the literature database');
 const manifest=await json('/api/library/static/manifest.json'),key=manifest.default_order[0],pageName=String(manifest.key_pages[key]).padStart(4,'0');
 await db.prepare('INSERT INTO visibility(kind,item_key,visible) VALUES(?,?,0)').bind('article',key).run();
 await db.prepare('INSERT INTO articles(key,payload,removed,editor,updated) VALUES(?,?,0,?,?)').bind(key,JSON.stringify({key,title:'Hidden revised title',abstract:'Hidden revised abstract'}),'local-owner',new Date().toISOString()).run();const state=await json('/api/library/state');assert.ok(state.hidden.includes(key));assert.ok(!state.upserts.some(d=>d.key===key),'hidden edits must not leak through live-state responses');
 const basePageData=JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(site,'__private_assets/runtime/public-library/'+manifest.pages.template.replace('{n}',pageName))))),hiddenDoc=basePageData.docs.find(d=>d.key===key),hiddenDocId=Number(pageName)*manifest.page_size+basePageData.docs.findIndex(d=>d.key===key),terms=searchContext.PublicSearchEngine.tokens(hiddenDoc.title);let targetTerm='',targetShard=0,originalPositions=[];for(const term of terms){const shard=searchContext.PublicSearchEngine.shard(term),file=path.join(site,'__private_assets/runtime/public-library/terms/'+String(shard).padStart(2,'0')+'.json.gz'),data=JSON.parse(zlib.gunzipSync(await fs.readFile(file))),values=searchContext.PublicSearchEngine.decode(data[term]||'');if(values.some(packed=>Math.floor(packed/manifest.doc_stride)===hiddenDocId)){targetTerm=term;targetShard=shard;originalPositions=values;break;}}assert.ok(targetTerm,'the hidden article title must have a public posting fixture');assert.ok(originalPositions.some(packed=>Math.floor(packed/manifest.doc_stride)===hiddenDocId));const termResponse=await get('/api/library/static/terms/'+String(targetShard).padStart(2,'0')+'.json.gz'),termData=JSON.parse(zlib.gunzipSync(Buffer.from(await termResponse.arrayBuffer()))),filteredPositions=searchContext.PublicSearchEngine.decode(termData[targetTerm]||'');assert.ok(!filteredPositions.some(packed=>Math.floor(packed/manifest.doc_stride)===hiddenDocId),'hidden paper postings must not reveal its public search position');
 const hiddenManifest=await json('/api/library/static/manifest.json');assert.ok(!hiddenManifest.default_order.includes(key));assert.ok(!hiddenManifest.initial.some(d=>d.key===key));
 const res=await get('/api/library/static/pages/'+pageName+'.json.gz');const content=await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();assert.ok(!content.docs.some(d=>d.key===key));
 const selected=await get('/api/library/document/'+key);assert.equal(selected.status,404);
 const legacy=await get('/api/library/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({groups:[],page:1,limit:20})});assert.equal(legacy.status,409,'an old cached client must refresh instead of scanning the database');
 const registration=await get('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'budget-reader',password:'local-budget-only-2026'})});assert.equal(registration.status,200,await registration.clone().text());const account=await registration.json(),cookie=registration.headers.get('set-cookie').split(';')[0],saves=[];let revision=0;
 for(let i=0;i<5;i++){const index=queries.length,response=await get('/api/workspace',{method:'PUT',headers:{'content-type':'application/json',cookie},body:JSON.stringify({user_id:account.user.id,revision,data:{'helix.notes.v9':JSON.stringify({example:{note:'Reader note '+i}})}})});assert.equal(response.status,200,await response.clone().text());revision=(await response.json()).revision;saves.push(queries.slice(index));}
 const report={checkedAt:new Date().toISOString(),checks:['first-page-20','guest-no-account','10-state-checks-and-20-pages-without-literature-SQL','hidden-cached-paper-filtered-in-manifest-page-and-detail'],startupQueries:startup,saveMetrics:saves.map(batch=>({read:batch.reduce((n,q)=>n+q.read,0),written:batch.reduce((n,q)=>n+q.written,0)})),searchStateRows:batches.map(batch=>batch.reduce((n,q)=>n+q.read,0)),totalReadRows:queries.reduce((n,q)=>n+q.read,0),totalWriteRows:queries.reduce((n,q)=>n+q.written,0),publicQueries:queries.length};await fs.writeFile(output+'/database-operation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await mf.dispose()}

