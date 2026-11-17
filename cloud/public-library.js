import {filterPublicPostings} from './public-postings.js';
const manifests=new WeakMap(),states=new WeakMap();
const hiddenPostingIds=new WeakMap();
const keyOf=env=>env.ASSETS||env.PRIVATE;
async function read(env,name){const object=await env.PRIVATE.get('runtime/public-library/'+name);if(!object)return null;let stream=object.body;if(name.endsWith('.gz'))stream=stream.pipeThrough(new DecompressionStream('gzip'));return new Response(stream).json();}
export async function publicManifest(env){const key=keyOf(env);if(!manifests.has(key))manifests.set(key,read(env,'manifest.json').catch(error=>{manifests.delete(key);throw error;}));return manifests.get(key);}
const rows=(db,q)=>db.prepare(q).all().then(v=>v.results||[]);
export async function publicState(env){
 if(!states.has(env))states.set(env,(async()=>{
  const manifest=await publicManifest(env);if(!manifest)return null;
  const [settings,revision,visibility,articles,submissions]=await Promise.all([
   env.DB.prepare('SELECT published FROM site_settings WHERE id=1').first(),env.DB.prepare('SELECT revision FROM catalog_revision WHERE id=1').first(),
   rows(env.DB,'SELECT kind,item_key FROM visibility WHERE visible=0'),rows(env.DB,'SELECT key,payload,removed FROM articles'),rows(env.DB,'SELECT id,published FROM submissions WHERE published IS NOT NULL'),
  ]);
  const site=settings?JSON.parse(settings.published):null,hidden=visibility.filter(r=>r.kind==='article').map(r=>String(r.item_key)),hiddenSubmissions=new Set(visibility.filter(r=>r.kind==='submission').map(r=>r.item_key)),removed=[],upserts=[];
  for(const r of articles){if(r.removed)removed.push(String(r.key));else upserts.push({...JSON.parse(r.payload),key:String(r.key)});}
  if(!site?.modules?.some(m=>m.id==='papers'&&m.visible===false))for(const r of submissions){if(hiddenSubmissions.has(r.id))continue;const value=JSON.parse(r.published);upserts.push({...value.article,key:'submission-'+r.id,submission_id:r.id});}
  const state={verified:true,backend:'static',version:manifest.version+':'+(revision?.revision||0),base_version:manifest.version,base_url:'/api/library/static/',hidden,removed,upserts:[],modules:site?.modules||[],site};
  if(allowed(state,'search'))state.upserts=upserts.filter(doc=>visible(state,doc,manifest));
  return state;
 })());return states.get(env);
}
const allowed=(state,id)=>!state.modules?.some(m=>m.id===id&&m.visible===false);
function visible(state,record,manifest){const ids=[record.key,record.pmid,record.doi,...(manifest.aliases?.[record.key]||[])].filter(Boolean).map(String);return !ids.some(id=>state.hidden.includes(id))&&!state.removed.includes(String(record.key));}
async function postingIds(env,state,manifest){
 if(hiddenPostingIds.has(state))return hiddenPostingIds.get(state);
 const pending=(async()=>{
  const aliases=new Map();for(const [key,values]of Object.entries(manifest.aliases||{}))for(const value of values)aliases.set(String(value),key);
  const hiddenKeys=new Set([...state.hidden,...state.removed].map(value=>aliases.get(String(value))||String(value)).filter(key=>manifest.key_pages[key]!=null));
  const pages=new Map();for(const key of hiddenKeys){const page=manifest.key_pages[key];if(!pages.has(page))pages.set(page,new Set());pages.get(page).add(key);}
  const ids=new Set();for(const [page,keys]of pages){const data=await read(env,manifest.pages.template.replace('{n}',String(page).padStart(4,'0')));for(let index=0;index<(data?.docs||[]).length;index++)if(keys.has(String(data.docs[index]?.key)))ids.add(page*manifest.page_size+index);}
  return ids;
 })();hiddenPostingIds.set(state,pending);try{return await pending;}catch(error){hiddenPostingIds.delete(state);throw error;}
}
export async function staticLibraryPage(env,state,offset=0,limit=20,onlyKey=null){
 const m=await publicManifest(env),overrides=new Map(state.upserts.map(d=>[String(d.key),d]));
 let keys=m.default_order.filter(key=>visible(state,{key},m)&&!overrides.has(key));
 const extra=state.upserts.filter(d=>!d.date_pending&&visible(state,d,m));
 if(onlyKey){const key=String(onlyKey),found=Object.keys(m.key_pages).find(k=>k===key||(m.aliases?.[k]||[]).includes(key));keys=found&&visible(state,{key:found},m)?[found]:[];const d=extra.find(d=>[d.key,d.pmid,d.doi].map(String).includes(key));if(d)return {docs:[d],total:1,version:state.version,next:null};}
 else if(extra.length){const dates=m.dates||{};keys=[...keys,...extra.map(d=>d.key)].sort((a,b)=>{const x=overrides.get(a),y=overrides.get(b),da=x?.firstdate||x?.year||dates[a]||'',db=y?.firstdate||y?.year||dates[b]||'';return String(db).localeCompare(String(da))||String(a).localeCompare(String(b));});}
 const total=keys.length,start=onlyKey?0:Math.max(0,Number(offset)||0),count=Math.max(1,Math.min(100,Number(limit)||20)),selected=keys.slice(start,start+count),pages=[...new Set(selected.filter(k=>!overrides.has(k)).map(k=>m.key_pages[k]))],docs=new Map(extra.map(d=>[d.key,d]));
 for(const page of pages){const data=await read(env,m.pages.template.replace('{n}',String(page).padStart(4,'0')));for(const d of data?.docs||[])if(selected.includes(d.key)&&visible(state,d,m))docs.set(d.key,d);}
 return {docs:selected.map(k=>docs.get(k)).filter(Boolean),total,version:state.version,next:start+selected.length<total?start+selected.length:null};
}
export async function staticLibraryResource(request,env,name){
 if(!/^(?:manifest\.json|metadata\/\d+\.json\.gz|terms\/\d+\.json\.gz|pages\/\d+\.json\.gz)$/.test(name))return new Response('资源不存在',{status:404});
 const state=await publicState(env);if(!state||!allowed(state,'search'))return new Response('文献资源暂未公开',{status:404});
 const m=await publicManifest(env),changed=state.hidden.length||state.removed.length||state.upserts.length;
 if(name==='manifest.json'){
  let manifest={...m,base_url:state.base_url};
  if(changed){const keys=new Set(Object.keys(m.key_pages).filter(key=>visible(state,{key},m))),pick=value=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>keys.has(key)));manifest={...manifest,key_pages:pick(m.key_pages),aliases:pick(m.aliases),dates:pick(m.dates),default_order:m.default_order.filter(k=>keys.has(k)),initial:m.initial.filter(d=>visible(state,d,m))};}
  return Response.json(manifest,{headers:{'cache-control':'no-store'}});
 }
 const object=await env.PRIVATE.get('runtime/public-library/'+name);if(!object)return new Response('资源不存在',{status:404});
 if(changed&&name.startsWith('terms/')){const data=await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).json(),filtered=filterPublicPostings(data,await postingIds(env,state,m),m.doc_stride);const stream=new Blob([JSON.stringify(filtered)]).stream().pipeThrough(new CompressionStream('gzip'));return new Response(stream,{headers:{'content-type':'application/octet-stream','cache-control':'no-store'}});}
 if(changed){const data=await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).json();data.docs=data.docs.map(d=>d&&visible(state,d,m)?d:null).filter(d=>d||name.startsWith('metadata/'));const stream=new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));return new Response(stream,{headers:{'content-type':'application/octet-stream','cache-control':'no-store'}});}
 return new Response(object.body,{headers:{'content-type':'application/octet-stream','cache-control':'no-store'}});
}
export function moduleAllowed(state,id){return allowed(state,id);}
