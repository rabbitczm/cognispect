import {sitemapPage} from '../cloud/search-pages.js';
import {createPrivateStorage} from '../cloud/free-storage.js';
import {publicState,publicManifest,moduleAllowed} from '../cloud/public-library.js';
import {libraryIndex} from '../cloud/library.js';
export async function onRequest({request,env}){
 try{
  env={...env,PRIVATE:createPrivateStorage(env,new URL(request.url).origin)};
  const state=await publicState(env);
  if(!state)return await sitemapPage(()=>libraryIndex(env));
  const manifest=await publicManifest(env),blocked=new Set([...state.hidden,...state.removed]);
  const keys=moduleAllowed(state,'search')?manifest.default_order.filter(key=>![key,...(manifest.aliases?.[key]||[])].some(k=>blocked.has(k))):[];
  const upserts=moduleAllowed(state,'search')?state.upserts.filter(d=>!d.date_pending&&![d.key,d.pmid,d.doi].some(k=>blocked.has(k))):[];
  return sitemapPage(async()=>({docs:[...new Set([...keys,...upserts.map(d=>d.key)])].map(key=>({key}))}));
 }catch{
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://cognispect.tech/</loc></url></urlset>',{status:503,headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store','retry-after':'3600'}});
 }
}
