import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {Miniflare}=await import(pathToFileURL('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare/dist/src/index.js'));
const docs=Array.from({length:100},(_,i)=>({key:String(i+1),pmid:String(i+1),title:'Research '+(i+1),year:'2024'}));
const assets=new Map([
 ['runtime/library-pages/index.json',{total:100,pages:1,chunk_size:100,version:'test-1'}],
 ['runtime/library-index.json',{docs,version:'test-1'}],
 ['runtime/library-pages/0000.json',{docs,abstracts:{'41':'Abstract forty one'},translations:{},translation_sources:{},focus:{},verify:{},sources:[]}],
 ['runtime/catalog.json',{docs}],
]);
const mf=new Miniflare({modules:true,scriptPath:'cloud/worker.js',compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],modulesRules:[{type:'ESModule',include:['**/*.js'],fallthrough:true}],d1Databases:['DB'],serviceBindings:{ASSETS:async request=>{
 const key=new URL(request.url).pathname.slice('/__private_assets/'.length);
 if(key==='manifest.json')return Response.json({objects:Object.fromEntries([...assets].map(([key,value])=>[key,{parts:['/__private_assets/'+key],bytes:JSON.stringify(value).length,contentType:'application/json'}]))});
 return assets.has(key)?Response.json(assets.get(key)):new Response('Missing',{status:404});
}}});
try{
 const db=await mf.getD1Database('DB');
 for(const file of (await fs.readdir('cloud/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let statement='',trigger=false;
  for(const line of (await fs.readFile('cloud/migrations/'+file,'utf8')).split(/\r?\n/)){
   statement+=line+'\n';if(/\bBEGIN\s*$/i.test(line))trigger=true;if(/\bEND;\s*$/i.test(line))trigger=false;
   if(/;\s*$/.test(line)&&!trigger){await db.prepare(statement.trim()).run();statement='';}
  }
 }
 const get=async route=>{const r=await mf.dispatchFetch('https://example.test'+route);assert.equal(r.status,200,await r.clone().text());return r.json();};
 const first=await get('/api/library?limit=40');
 assert.equal(first.docs.length,40,'the initial page must show 40 papers without waiting for all 100');
 assert.equal(first.next,40);
 const second=await get('/api/library?offset=40&limit=40');
 assert.equal(second.docs[0].key,'41','loading more must continue at the requested offset');
 assert.equal(second.docs.length,40);
 const detail=await get('/api/library/document/41');
 assert.equal(detail.abstracts['41'],'Abstract forty one');
 const before=await get('/api/library/meta');
 await db.prepare("INSERT INTO visibility(kind,item_key,visible) VALUES('article','41',0)").run();
 const after=await get('/api/library/meta');
 assert.notEqual(after.version,before.version,'hiding a paper must invalidate public caches');
 const index=await get('/api/library/index');
 assert.equal(index.docs.some(d=>d.key==='41'),false);
 assert.equal((await mf.dispatchFetch('https://example.test/api/library/document/41')).status,404);
 console.log('PASS: initial 40, continuous pagination, on-demand detail, cache invalidation and hidden paper');
}finally{await mf.dispose();}
