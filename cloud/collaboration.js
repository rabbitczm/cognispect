const stmt=(db,q,...args)=>db.prepare(q).bind(...args);
const one=(db,q,...args)=>stmt(db,q,...args).first();
const rows=async(db,q,...args)=>(await stmt(db,q,...args).all()).results||[];
const uid=()=>crypto.randomUUID().replaceAll('-','');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export async function sharedPdfAllowed(db,pdfId,userId){return !!await one(db,'SELECT n.id FROM research_notes n JOIN note_members m ON m.note_id=n.id WHERE n.source_pdf_id=? AND m.user_id=? AND m.share_pdf=1',pdfId,userId);}
export async function noteRoute(request,env,ctx){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!path.startsWith('/api/notes'))return null;
 const {requireUser,json,body}=ctx,user=await requireUser(request,env),db=env.DB;
 async function permission(id){const note=await one(db,'SELECT * FROM research_notes WHERE id=?',id);if(!note)fail('笔记不存在',404);const member=note.owner_id===user.id?null:await one(db,'SELECT * FROM note_members WHERE note_id=? AND user_id=?',id,user.id);if(note.owner_id!==user.id&&!member)fail('笔记不存在',404);return {note,isOwner:note.owner_id===user.id,member,canReview:note.owner_id===user.id||member?.permission==='review'};}
 function model(note,p){return {...note,is_owner:p.isOwner,permission:p.isOwner?'owner':p.member.permission,share_pdf:p.isOwner?true:!!p.member.share_pdf,legacy_highlights:JSON.parse(note.legacy_highlights||'[]')};}
 async function detail(id){const p=await permission(id);return {note:model(p.note,p),members:await rows(db,'SELECT m.*,c.username FROM note_members m JOIN account_credentials c ON c.user_id=m.user_id WHERE m.note_id=?',id),comments:await rows(db,'SELECT x.*,c.username AS author_name FROM note_comments x LEFT JOIN account_credentials c ON c.user_id=x.author_id WHERE x.note_id=? ORDER BY x.created_at',id),suggestions:await rows(db,'SELECT x.*,c.username AS author_name FROM note_suggestions x LEFT JOIN account_credentials c ON c.user_id=x.author_id WHERE x.note_id=? ORDER BY x.created_at DESC',id),versions:await rows(db,'SELECT x.*,c.username AS author_name FROM note_versions x LEFT JOIN account_credentials c ON c.user_id=x.author_id WHERE x.note_id=? ORDER BY x.version DESC',id)};}
 if(path==='/api/notes/shared'&&method==='GET')return json({notes:await rows(db,'SELECT n.id,n.paper_key,n.title,n.owner_id,n.version,n.source_pdf_id,m.permission,m.share_pdf,c.username AS owner_name FROM research_notes n JOIN note_members m ON m.note_id=n.id LEFT JOIN account_credentials c ON c.user_id=n.owner_id WHERE m.user_id=? ORDER BY n.updated_at DESC',user.id)});
 if(path==='/api/notes'&&method==='GET'){const note=await one(db,'SELECT * FROM research_notes WHERE owner_id=? AND paper_key=?',user.id,url.searchParams.get('paper_key')||'');return json({note:note?model(note,{isOwner:true}):null});}
 if(path==='/api/notes'&&method==='POST'){
  const input=await body(request),paperKey=String(input.paper_key||'').trim();if(!paperKey)fail('缺少文献编号');
  const old=await one(db,'SELECT id FROM research_notes WHERE owner_id=? AND paper_key=?',user.id,paperKey);if(old)return json(await detail(old.id));
  const pdfId=input.source_pdf_id||(paperKey.startsWith('pdf:')?paperKey.slice(4):null);
  if(pdfId&&!await one(db,'SELECT id FROM user_pdfs WHERE id=? AND owner=?',pdfId,user.id))fail('私人 PDF 不存在',404);
  const id=uid(),stamp=Date.now(),content=String(input.content||'');
  await db.batch([stmt(db,'INSERT INTO research_notes(id,owner_id,paper_key,title,content,version,source_pdf_id,legacy_highlights,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,?)',id,user.id,paperKey,String(input.title||'文献笔记'),content,pdfId,JSON.stringify(input.legacy_highlights||[]),stamp,stamp),stmt(db,'INSERT INTO note_versions VALUES(?,?,?,?,?)',id,1,content,user.id,stamp)]);
  return json(await detail(id));
 }
 const match=path.match(/^\/api\/notes\/([a-f0-9]+)(?:\/(members|comments|suggestions)(?:\/([^/]+))?(?:\/(accept|reject))?)?$/);
 if(!match)return json({error:'笔记接口不存在'},404);
 const [,id,section,item,action]=match,p=await permission(id),input=['GET','DELETE'].includes(method)?{}:await body(request);
 if(!section&&method==='GET')return json(await detail(id));
 async function saveContent(content,version,title){
  if(Number(version)!==p.note.version)fail('笔记已更新，请查看最新版本后再提交',409);
  const next=p.note.version+1,stamp=Date.now();
  const results=await db.batch([
   stmt(db,'UPDATE research_notes SET content=?,title=?,version=?,updated_at=? WHERE id=? AND version=?',content,title||p.note.title,next,stamp,id,p.note.version),
   stmt(db,'INSERT OR IGNORE INTO note_versions SELECT id,version,content,?,? FROM research_notes WHERE id=? AND version=? AND content=?',user.id,stamp,id,next,content)
  ]);
  if(!results[0].meta.changes)fail('笔记已更新，请查看最新版本后再提交',409);
 }
 if(!section&&method==='PUT'){if(!p.isOwner)fail('请提交修改建议，由笔记主人采纳',403);await saveContent(String(input.content??''),input.version,input.title);return json(await detail(id));}
 if(section==='members'){
  if(!p.isOwner)fail('只有笔记主人可以管理分享',403);
  if(method==='POST'){
   if(!['view','review'].includes(input.permission))fail('请选择查看或审阅权限');
   const target=await one(db,'SELECT c.user_id FROM account_credentials c JOIN users u ON u.id=c.user_id WHERE c.username=? COLLATE NOCASE AND u.active=1',String(input.username||'').trim());
   if(!target)fail('该账号不存在，请让对方先注册');if(target.user_id===user.id)fail('你已是笔记主人');
   await stmt(db,'INSERT INTO note_members(note_id,user_id,permission,share_pdf) VALUES(?,?,?,?) ON CONFLICT(note_id,user_id) DO UPDATE SET permission=excluded.permission,share_pdf=excluded.share_pdf',id,target.user_id,input.permission,input.share_pdf&&p.note.source_pdf_id?1:0).run();return json(await detail(id));
  }
  if(method==='DELETE'&&item){await stmt(db,'DELETE FROM note_members WHERE note_id=? AND user_id=?',id,item).run();return json({removed:true});}
 }
 if(section==='comments'){
  if(!p.canReview)fail('当前分享仅允许查看',403);
  if(method==='POST'){const content=String(input.content||'').trim();if(!content)fail('请填写批注');if(input.parent_id&&!await one(db,'SELECT id FROM note_comments WHERE id=? AND note_id=?',input.parent_id,id))fail('原批注不存在');const commentId=uid();await stmt(db,'INSERT INTO note_comments(id,note_id,author_id,content,quote,page,parent_id,resolved,created_at) VALUES(?,?,?,?,?,?,?,0,?)',commentId,id,user.id,content,String(input.quote||''),input.page?Number(input.page):null,input.parent_id||null,Date.now()).run();return json({comment:await one(db,'SELECT x.*,c.username AS author_name FROM note_comments x LEFT JOIN account_credentials c ON c.user_id=x.author_id WHERE x.id=?',commentId)});}
  if(method==='PATCH'&&item){const comment=await one(db,'SELECT author_id FROM note_comments WHERE id=? AND note_id=?',item,id);if(!comment)fail('批注不存在',404);if(!p.isOwner&&comment.author_id!==user.id)fail('请由批注作者或笔记主人处理',403);await stmt(db,'UPDATE note_comments SET resolved=? WHERE id=?',input.resolved?1:0,item).run();return json({saved:true});}
 }
 if(section==='suggestions'){
  if(!p.canReview)fail('当前分享仅允许查看',403);
  if(method==='POST'&&!item){if(Number(input.version)!==p.note.version)fail('笔记已更新，请先读取最新版本',409);const sid=uid();await stmt(db,'INSERT INTO note_suggestions VALUES(?,?,?,?,?,?,?,?)',sid,id,user.id,p.note.version,String(input.content??''),String(input.note||''),'pending',Date.now()).run();return json({suggestion:await one(db,'SELECT * FROM note_suggestions WHERE id=?',sid)});}
  if(method==='POST'&&item&&action){if(!p.isOwner)fail('只有笔记主人可以接受或拒绝修改',403);const suggestion=await one(db,'SELECT * FROM note_suggestions WHERE id=? AND note_id=?',item,id);if(!suggestion||suggestion.status!=='pending')fail('这条修改建议已处理或不存在');if(action==='accept'){if(suggestion.base_version!==p.note.version)fail('修改建议基于旧版笔记，请对比后重新提交',409);await saveContent(suggestion.content,input.version);}await stmt(db,'UPDATE note_suggestions SET status=? WHERE id=?',action==='accept'?'accepted':'rejected',item).run();return json(await detail(id));}
 }
 return json({error:'笔记操作不存在'},404);
}
