import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Miniflare}=require('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const site=path.join(root,'scratch/cloud-site');
const state=path.resolve('D:/workspace/codex_list/scratch/pages-assets-check');
const types={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const mf=new Miniflare({modules:true,scriptPath:path.join(site,'_worker.js/index.js'),compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:8122,d1Databases:{DB:'pages-assets-db'},d1Persist:path.join(state,'d1'),serviceBindings:{ASSETS:async request=>{
 const url=new URL(request.url),relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html',target=path.resolve(site,relative);
 if(!target.startsWith(site+path.sep))return new Response('missing',{status:404});
 try{
  const bytes=await fs.readFile(target),headers={'content-type':types[path.extname(target)]||'application/octet-stream'},range=request.headers.get('range')?.match(/^bytes=(\d+)-(\d+)$/);
  if(range){const start=Number(range[1]),end=Math.min(Number(range[2]),bytes.length-1);return new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'content-range':`bytes ${start}-${end}/${bytes.length}`}});}
  return new Response(bytes,{headers});
 }catch{return new Response('missing',{status:404});}
}}});
let browser;
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const name of ['0001_initial.sql','0002_free_storage.sql']){
  const schema=await fs.readFile(path.join(root,'cloud/migrations',name),'utf8');
  for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 }
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir='+path.join(state,'chrome-cache')]});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:8122/intro.html');
 const statuses=await page.evaluate(async()=>{
  const paths=['/__private_assets','/__private_assets/manifest.json','/__private_assets/runtime/catalog.json','/__private_assets/assets/anatomy/muscles.js.part-0000'];
  return Promise.all(paths.map(async path=>[path,(await fetch(path)).status]));
 });for(const [url,status]of statuses)assert.equal(status,404,url);
 const library=await fetch('http://127.0.0.1:8122/api/library').then(r=>r.json());assert.equal(library.total,2310);assert.equal(library.docs.length,100);
 const meshResponse=await fetch('http://127.0.0.1:8122/assets/anatomy/muscles.js');assert.equal(meshResponse.status,200);
 const mesh=Buffer.from(await meshResponse.arrayBuffer()),original=await fs.readFile(path.join(root,'assets/anatomy/muscles.js'));assert.ok(mesh.equals(original),'The browser anatomy endpoint must preserve every mesh byte');
 await db.prepare('INSERT OR REPLACE INTO site_settings(id,draft,published,previous,admin_limit) VALUES(1,?,?,NULL,NULL)').bind(JSON.stringify({modules:[{id:'anatomy',visible:false}]}),JSON.stringify({modules:[{id:'anatomy',visible:false}]})).run();
 assert.equal((await fetch('http://127.0.0.1:8122/assets/anatomy/muscles.js')).status,404);
 const report={internalRoutes:statuses,corpusTotal:library.total,musclesBytes:mesh.length,meshReassembly:'byte-identical',hiddenAnatomyStatus:404,r2Binding:false};
 const output='D:/workspace/codex_list/output/zhijing-cloud/verification/pages-assets.json';await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await mf.dispose();}
