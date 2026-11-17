import assert from 'node:assert/strict';
import {onRequest} from '../functions/index.js';
const env={ASSETS:{async fetch(request){
 const path=new URL(request.url).pathname;
 if(path.endsWith('.html'))return new Response(null,{status:308,headers:{location:path.replace(/\.html$/,'')}});
 const names={'/__private_assets/site/main.bin':'MAIN','/__private_assets/site/intro.bin':'INTRO','/__private_assets/site/admin.bin':'ADMIN'};
 return new Response(names[path]||'MISSING',{status:names[path]?200:404,headers:{'content-type':'application/octet-stream'}});
}}};
for(const [path,headers,want] of [['/',{},'MAIN'],['/?intro=done',{},'MAIN'],['/',{cookie:'zhijing_intro=done'},'MAIN'],['/admin',{},'ADMIN'],['/intro',{},'INTRO']]){
 const response=await onRequest({request:new Request('https://cognispect.tech'+path,{headers}),env});
 assert.equal(response.status,200,'Pages HTML canonicalization must not redirect '+path);
 assert.match(response.headers.get('content-type'),/text\/html/);
 assert.equal(await response.text(),want);
}
console.log('PASS Pages entry pages avoid HTML canonical redirect loops');
