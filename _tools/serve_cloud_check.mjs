import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Miniflare}=require('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const site=path.join(root,'scratch/cloud-site');
const state=path.join('D:/workspace/codex_list/scratch','cloud-preview-'+Date.now());
const types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json'};
const mf=new Miniflare({modules:true,scriptPath:path.join(site,'_worker.js/index.js'),compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:8120,d1Databases:{DB:'test-db'},d1Persist:path.join(state,'d1'),bindings:{TEST_OTP:'606060',RESEND_FROM:'知镜测试 <login@example.org>',HELIX_MAX_UPLOAD_MB:'30'},serviceBindings:{ASSETS:async request=>{
 const url=new URL(request.url);let relative=decodeURIComponent(url.pathname).replace(/^\//,'');if(relative==='admin')relative='admin.html';if(relative==='intro')relative='intro.html';if(!relative)relative='index.html';
 const target=path.resolve(site,relative);if(!target.startsWith(site+path.sep))return new Response('Not found',{status:404});
 try{
  const bytes=await fs.readFile(target),headers={'content-type':types[path.extname(target)]||'application/octet-stream'};
  const range=request.headers.get('range')?.match(/^bytes=(\d+)-(\d+)$/);
  if(range){const start=Number(range[1]),end=Math.min(Number(range[2]),bytes.length-1);return new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'content-range':`bytes ${start}-${end}/${bytes.length}`}});}
  return new Response(bytes,{headers});
 }catch{return new Response('Not found',{status:404});}
}}});
try{
 await mf.ready;
 const db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir(path.join(root,'cloud/migrations'))).filter(name=>name.endsWith('.sql')).sort()){
  const schema=await fs.readFile(path.join(root,'cloud/migrations',name),'utf8');
  for(const statement of schema.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 for(const [id,email,role] of [['owner-test','owner@example.org','owner'],['admin-test','admin@example.org','admin'],['researcher-test','researcher@example.org','user']])await db.prepare('INSERT OR REPLACE INTO users(id,email,role,active,verified,created_at) VALUES(?,?,?,1,1,?)').bind(id,email,role,Date.now()).run();
 console.log('Cloudflare Pages local preview ready: http://127.0.0.1:8120 (isolated D1 + ASSETS, no R2)');
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await mf.dispose();process.exit();});
}catch(error){console.error(error);await mf.dispose();process.exitCode=1;}



