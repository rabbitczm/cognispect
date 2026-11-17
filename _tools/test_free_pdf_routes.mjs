import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {passwordHash,secretHash} from '../cloud/auth-password.js';
const {Miniflare}=await import(pathToFileURL('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare/dist/src/index.js'));
const mf=new Miniflare({modules:true,compatibilityDate:'2026-08-06',modulesRules:[{type:'ESModule',include:['**/*.js'],fallthrough:true}],scriptPath:'cloud/worker.js',d1Databases:['DB'],bindings:{TEST_OTP:'606060'}});
try{
 const db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir('cloud/migrations')).filter(x=>x.endsWith('.sql')).sort())for(const query of (await fs.readFile('cloud/migrations/'+name,'utf8')).split(/;\s*(?:\r?\n|$)/).map(x=>x.trim()).filter(Boolean))await db.prepare(query).run();
 await db.prepare("INSERT INTO users VALUES('owner','owner@example.test','owner',1,1,1)").run();
 await db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?)').bind('owner','owner',await passwordHash('owner-password-123'),await secretHash('owner-recovery-code'),Date.now()).run();
 const req=(route,init={})=>mf.dispatchFetch('https://example.test'+route,init);
 const login=await req('/api/auth/login',{method:'POST',body:JSON.stringify({username:'owner',password:'owner-password-123'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const authed=(route,init={})=>req(route,{...init,headers:{cookie,...init.headers}});
 const raw=new Uint8Array(2*1024*1024+37).fill(65);raw.set(new TextEncoder().encode('%PDF-1.7\n'));raw[raw.length-1]=90;
 const started=await authed('/api/pdf/uploads',{method:'POST',body:JSON.stringify({name:'分片测试.pdf',bytes:raw.length})});
 assert.equal(started.status,200,'a signed-in researcher can start a cloud PDF upload without R2');const pending=await started.json();
 assert.equal((await authed('/api/pdf/document/'+pending.id)).status,404,'unfinished PDFs must not appear as complete documents');
 assert.equal((await authed('/api/pdf/uploads/'+pending.id+'/complete',{method:'POST'})).status,409);
 for(let offset=0,index=0;offset<raw.length;offset+=pending.chunk_size,index++){const response=await authed('/api/pdf/uploads/'+pending.id+'/chunks/'+index,{method:'PUT',body:raw.slice(offset,offset+pending.chunk_size)});assert.equal(response.status,200,await response.text());}
 const complete=await authed('/api/pdf/uploads/'+pending.id+'/complete',{method:'POST'});assert.equal(complete.status,200);const pdf=await complete.json();
 assert.equal((await authed('/api/pdf/document/'+pdf.id)).status,200);
 const downloaded=await authed(pdf.url);assert.equal(downloaded.status,200);assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),raw);
 const range=await authed(pdf.url,{headers:{range:'bytes=1048574-1048580'}});assert.equal(range.status,206);assert.deepEqual(new Uint8Array(await range.arrayBuffer()),raw.slice(1048574,1048581));
 assert.equal((await req(pdf.url)).status,401);
 const saved=await authed('/api/submissions',{method:'POST',body:JSON.stringify({article:{title:'分片文献',source_url:'https://example.org/paper'},pdf_id:pdf.id,share_pdf:true,sharing_permission:'自制文件'})});assert.equal(saved.status,200);const submission=await saved.json();
 assert.equal((await authed('/api/submissions/'+submission.id+'/submit',{method:'POST'})).status,200);
 assert.equal((await authed('/api/admin/submissions/'+submission.id+'/review',{method:'POST',body:JSON.stringify({decision:'approved'})})).status,200);
 await authed('/api/pdf/remove',{method:'POST',body:JSON.stringify({id:pdf.id})});
 const published=await req('/api/public/submissions/'+submission.id+'/pdf');assert.equal(published.status,200);assert.deepEqual(new Uint8Array(await published.arrayBuffer()),raw);
 await db.prepare("INSERT INTO visibility VALUES('submission',?,0)").bind(submission.id).run();
 assert.equal((await req('/api/public/submissions/'+submission.id+'/pdf')).status,404);
 console.log('PASS free PDF chunk upload, completion, range download, private access, approval snapshot and hiding');
}finally{await mf.dispose();}
