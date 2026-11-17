import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {Miniflare}=await import(pathToFileURL('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare/dist/src/index.js'));
const mf=new Miniflare({modules:true,compatibilityDate:'2026-08-06',modulesRules:[{type:'ESModule',include:['**/*.js'],fallthrough:true}],scriptPath:'cloud/worker.js',d1Databases:['DB']});
try{
 const db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir('cloud/migrations')).filter(x=>x.endsWith('.sql')).sort()){
  let statement='',trigger=false;
  for(const line of (await fs.readFile('cloud/migrations/'+name,'utf8')).split(/\r?\n/)){
   statement+=line+'\n';if(/\bBEGIN\s*$/i.test(line))trigger=true;if(/\bEND;\s*$/i.test(line))trigger=false;
   if(/;\s*$/.test(line)&&!trigger){await db.prepare(statement.trim()).run();statement='';}
  }
 }
 const req=(path,data,cookie,method='POST')=>mf.dispatchFetch('https://example.test'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
 const register=async username=>{const r=await req('/api/auth/register',{username,password:'normal-user-password'});assert.equal(r.status,200,await r.clone().text());const data=await r.json();assert.ok(data.recovery_code);return {data,cookie:r.headers.get('set-cookie').split(';')[0]};};
 const owner=await register('研究甲'),reviewer=await register('研究乙');
 assert.equal(owner.data.user.username,'研究甲');
 const session=await req('/api/auth/session',undefined,null,'GET');assert.equal(session.headers.get('set-cookie'),null);
 const wrong=await req('/api/auth/login',{username:'研究甲',password:'wrong-password'});assert.equal(wrong.status,401);
 const good=await req('/api/auth/login',{username:'研究甲',password:'normal-user-password'});assert.equal(good.status,200);
 const created=await req('/api/notes',{paper_key:'111',title:'测试笔记',content:'初稿'},owner.cookie);assert.equal(created.status,200,await created.clone().text());const {note}=await created.json();
 assert.equal((await req('/api/notes/'+note.id,undefined,reviewer.cookie,'GET')).status,404);
 assert.equal((await req('/api/notes/'+note.id+'/members',{username:'研究乙',permission:'review'},owner.cookie)).status,200);
 const suggestion=await req('/api/notes/'+note.id+'/suggestions',{version:1,content:'修订稿',note:'补充方法'},reviewer.cookie);assert.equal(suggestion.status,200,await suggestion.clone().text());const proposed=await suggestion.json();
 assert.equal((await req('/api/notes/'+note.id+'/suggestions/'+proposed.suggestion.id+'/accept',{version:1},owner.cookie)).status,200);
 const accepted=await req('/api/notes/'+note.id,undefined,reviewer.cookie,'GET').then(r=>r.json());assert.equal(accepted.note.content,'修订稿');assert.equal(accepted.note.version,2);
 assert.equal((await req('/api/notes/'+note.id+'/members/'+reviewer.data.user.id,undefined,owner.cookie,'DELETE')).status,200);
 assert.equal((await req('/api/notes/'+note.id,undefined,reviewer.cookie,'GET')).status,404);
 const recovered=await req('/api/auth/reset-password',{username:'研究甲',recovery_code:owner.data.recovery_code,password:'replacement-password'});assert.equal(recovered.status,200);assert.ok((await recovered.json()).recovery_code);
 const ownerAgain=await req('/api/auth/login',{username:'研究甲',password:'replacement-password'});assert.equal(ownerAgain.status,200);const ownerCookie=ownerAgain.headers.get('set-cookie').split(';')[0];
 const change=await req('/api/auth/change-password',{current_password:'replacement-password',password:'third-password-123'},ownerCookie);assert.equal(change.status,200,await change.clone().text());assert.equal((await req('/api/auth/session',undefined,ownerCookie,'GET')).status,200);
 assert.ok((await req('/api/auth/session',undefined,ownerCookie,'GET').then(r=>r.json())).authenticated);
 const pdfResponse=await mf.dispatchFetch('https://example.test/api/pdf/upload',{method:'POST',headers:{cookie:ownerCookie,'x-filename':encodeURIComponent('私有论文.pdf')},body:'%PDF-1.7\nprivate'});assert.equal(pdfResponse.status,200,await pdfResponse.clone().text());const pdf=await pdfResponse.json();
 const pdfNote=await req('/api/notes',{paper_key:'pdf:'+pdf.id,title:'私有论文',source_pdf_id:pdf.id},ownerCookie);assert.equal(pdfNote.status,200,await pdfNote.clone().text());const doc=(await pdfNote.json()).note;
 assert.equal((await req('/api/pdf/file/'+pdf.id,undefined,reviewer.cookie,'GET')).status,404);
 await req('/api/notes/'+doc.id+'/members',{username:'研究乙',permission:'review',share_pdf:true},ownerCookie);
 const sharedFile=await req('/api/pdf/file/'+pdf.id,undefined,reviewer.cookie,'GET');assert.equal(sharedFile.status,200);assert.equal(await sharedFile.text(),'%PDF-1.7\nprivate');
 await db.prepare("UPDATE users SET role='owner' WHERE id=?").bind(owner.data.user.id).run();
 await db.prepare("INSERT INTO users(id,email,role,active,verified,created_at) VALUES('legacy-admin','legacy@example.test','admin',1,1,?)").bind(Date.now()).run();
 const removed=await req('/api/admin/users/remove',{user_id:'legacy-admin'},ownerCookie);assert.equal(removed.status,200);
 const legacy=await db.prepare("SELECT role,active FROM users WHERE id='legacy-admin'").first();assert.equal(legacy.role,'user');assert.equal(legacy.active,0);
 console.log('PASS password login, recovery, invite/suggest/accept/revoke and legacy admin removal workflows');
}finally{await mf.dispose();}
