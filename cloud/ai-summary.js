import { libraryPage } from './library.js';
import {sharedResponse} from './ai-inflight.js';
const stmt=(db,q,...args)=>db.prepare(q).bind(...args);
const one=(db,q,...args)=>stmt(db,q,...args).first();
const uid=()=>crypto.randomUUID().replaceAll('-','');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const parse=raw=>{let text=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(text)}catch{return null}};
const fingerprint=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function modelText(result){return String(result?.choices?.[0]?.message?.content??result?.choices?.[0]?.text??result?.response??result?.output??result?.text??'').trim();}
export async function summaryRoute(request,env,ctx){
 const url=new URL(request.url),path=url.pathname,method=request.method;if(path!=='/api/summaries')return null;
 const {json,body,requireUser}=ctx,db=env.DB;
 async function source(user,paperKey,explicit={}){
  const privateId=paperKey.startsWith('pdf:')?paperKey.slice(4):'';
  if(privateId){
   const pdf=await one(db,'SELECT owner,metadata FROM user_pdfs WHERE id=?',privateId);if(!pdf)fail('私人 PDF 不存在',404);
   if(pdf.owner!==user?.id&&!await one(db,'SELECT n.id FROM research_notes n JOIN note_members m ON m.note_id=n.id WHERE n.source_pdf_id=? AND m.user_id=? AND m.share_pdf=1',privateId,user?.id||''))fail('没有查看这份私人 PDF 的权限',403);
   const metadata=parse(pdf.metadata)||{},pages=Array.isArray(metadata.pages)?metadata.pages:[];
   const texts=pages.map(p=>({number:Number(p.number)||1,text:String(p.text||'')})).filter(p=>p.text.trim());
   return {title:String(metadata.title||metadata.name||explicit.title||'私人 PDF'),scope:'pdf',source_version:await fingerprint(JSON.stringify({updated:metadata.updated,bytes:metadata.bytes,pages:texts})),pages:texts};
  }
  const data=await libraryPage(env,false,0,40,paperKey),paper=data.docs?.[0];if(!paper)fail('公开文献不存在或已隐藏',404);
  const key=String(paper.pmid||paper.key),abstract=String(data.abstracts?.[key]||paper.abstract||'');
  if(!abstract)fail('这篇文献暂时没有可用摘要',422);
  return {title:paper.title||String(explicit.title||''),scope:'abstract',source_version:String(data.version||'')+':'+key+':'+abstract,abstract};
 }
 if(method==='GET'){
  const paperKey=String(url.searchParams.get('paper_key')||'').trim();if(!paperKey)fail('缺少文献编号');let user=null;if(paperKey.startsWith('pdf:'))user=await requireUser(request,env);
  const resolved=await source(user,paperKey);
  const record=await one(db,'SELECT id,paper_key,title,scope,source_version,content,created_at FROM paper_summaries WHERE paper_key=? AND owner_id=?',paperKey,user?.id||'');
  return json({summary:record&&record.source_version===resolved.source_version?{...record,content:parse(record.content)||record.content}:null});
 }
 if(method!=='POST')return json({error:'总结接口不支持此操作'},405);
 const user=await requireUser(request,env),input=await body(request),key=String(input.paper_key||'').trim();if(!key)fail('缺少文献编号');
 const privateId=key.startsWith('pdf:')?key.slice(4):'',resolved=await source(user,key,{title:input.title}),cached=await one(db,'SELECT id,paper_key,title,scope,source_version,content,created_at,owner_id FROM paper_summaries WHERE paper_key=? AND owner_id=?',key,privateId?user.id:'');
 if(cached&&cached.source_version===resolved.source_version)return json({summary:{...cached,content:parse(cached.content)||cached.content},cached:true});
 return sharedResponse(env.AI,JSON.stringify(['summary',privateId?user.id:'public',key,resolved.source_version]),async()=>{
 if(!env.AI?.run)return json({error:'AI 服务暂不可用',code:'AI_UNAVAILABLE'},503);
 const excerpts=resolved.scope==='abstract'?resolved.abstract:resolved.pages.map(p=>`第 ${p.number} 页：${p.text}`).join('\n\n');
 if(!excerpts.trim())fail('PDF 暂无可读取文本，无法生成总结',422);
 const model=env.AI_MODEL||'@cf/google/gemma-4-26b-a4b-it';
 async function run(text,detail){const prompt=`请用中文总结给出的医学论文${detail}，只依据输入文本，不补造数据和结论。输出合法 JSON，包含 question（研究问题）、methods（研究方法）、results（主要结果）、limitations（文本明确提到的局限，未提及时写“未在来源文本中说明”）、evidence（数组，每项含页码或“摘要”与原文短引文）。保留原始页码，指出无法从文本确认的信息。题名：${resolved.title}\n${text}`;const result=await env.AI.run(model,{messages:[{role:'system',content:'你是医学论文阅读助手，只依据输入证据总结，不给出临床诊断或治疗建议。只输出符合要求的 JSON，每项保持简洁。'},{role:'user',content:prompt}],max_completion_tokens:1600,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_object'},temperature:0.2});return modelText(result);}
 let text;
 try{
  if(resolved.scope==='abstract')text=await run(excerpts,'摘要');
  else{
   const units=[];for(const page of resolved.pages)for(let start=0;start<page.text.length;start+=9000)units.push({number:page.number,text:page.text.slice(start,start+9000)});
   const chunks=[];for(let i=0;i<units.length;i+=4){const group=units.slice(i,i+4),inputText=group.map(p=>`第 ${p.number} 页：${p.text}`).join('\n\n');chunks.push(await run(inputText,`文本片段 ${i+1}–${i+group.length}`));}
   text=chunks.length===1?chunks[0]:await run(chunks.map((part,i)=>`片段 ${i+1}：${part}`).join('\n\n'),'分段汇总');
  }
 }
 catch(error){if(/quota|limit|neurons|billing|exceeded/i.test(error.message||''))return json({error:'今日免费 AI 额度已用完，明日恢复后可继续生成。',code:'AI_QUOTA'},429);throw error;}
 if(!text)fail('AI 暂未生成可用内容，请稍后重试',503);
 const content=parse(text)||{summary:text};
 const id=cached?.id||uid(),created=Date.now(),owner=privateId?user.id:'';
 await stmt(db,'INSERT INTO paper_summaries(id,paper_key,owner_id,title,scope,source_version,content,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(paper_key,owner_id) DO UPDATE SET title=excluded.title,scope=excluded.scope,source_version=excluded.source_version,content=excluded.content,created_at=excluded.created_at',id,key,owner,resolved.title,resolved.scope,resolved.source_version,JSON.stringify(content),created).run();
 return json({summary:{id,paper_key:key,title:resolved.title,scope:resolved.scope,content,created_at:created},cached:false});
 });
}
