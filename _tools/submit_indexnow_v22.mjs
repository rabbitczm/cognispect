import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Agent,fetch}=require('D:/workspace/codex_list/tools/helix-wrangler/node_modules/undici');
const agent=new Agent({connect:{maxVersion:'TLSv1.2'}});
try{
 const {indexnow_key:key,canonical_origin:origin}=JSON.parse(await fs.readFile('data/search-discovery.json','utf8'));
 const keyResponse=await fetch(origin+'/'+key+'.txt',{dispatcher:agent,signal:AbortSignal.timeout(60000)});
 if(!keyResponse.ok||(await keyResponse.text()).trim()!==key)throw Error('IndexNow 网站验证文件尚未发布');
 const map=await fetch(origin+'/sitemap.xml',{dispatcher:agent,signal:AbortSignal.timeout(60000)});if(!map.ok)throw Error('站点地图读取未完成');
 const xml=await map.text(),urlList=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&')).filter(url=>url.startsWith(origin+'/'));
 const response=await fetch('https://api.indexnow.org/indexnow',{dispatcher:agent,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({host:new URL(origin).host,key,keyLocation:origin+'/'+key+'.txt',urlList}),signal:AbortSignal.timeout(60000)});
 const result={time:new Date().toISOString(),endpoint:'https://api.indexnow.org/indexnow',status:response.status,urls:urlList.length,accepted:[200,202].includes(response.status),response:(await response.text()).slice(0,1000),meaning:'提交受理状态，不表示已经收录或获得特定排名'};
 await fs.writeFile('D:/workspace/codex_list/output/zhijing-v22/verification/indexnow.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(!result.accepted)process.exitCode=1;
}finally{await agent.close();}
