import worker from '../../cloud/worker.js';
import {paperPage} from '../../cloud/search-pages.js';
export async function onRequest({request,env,params}){
 const key=String(params.key||'');
 return paperPage(request,async()=>{
  const response=await worker.fetch(new Request(new URL('/api/library/document/'+encodeURIComponent(key),request.url)),env);
  return response.ok?response.json():{docs:[]};
 },key);
}
