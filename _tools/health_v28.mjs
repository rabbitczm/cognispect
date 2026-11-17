import fs from 'node:fs/promises';
import {api,transport,account,authorization} from './cloud_access_v28.mjs';
const output='D:/workspace/codex_list/output/zhijing-v28';
const base=process.env.ZHIJING_HEALTH_URL||'https://cognispect.tech';
const result={checkedAt:new Date().toISOString(),base,checks:[]};
for(const p of ['/api/health','/api/bootstrap','/demo/','/robots.txt','/sitemap.xml']){const start=Date.now();try{const r=await transport(base+p),row={path:p,status:r.status,ms:Date.now()-start};if(p==='/api/bootstrap'){const v=await r.json();row.version=v.version;row.database=v.services?.database;row.papers=v.library?.docs?.length||0;}result.checks.push(row)}catch(error){result.checks.push({path:p,error:error.message})}}
try{const response=await transport('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:'Bearer '+await authorization(),'content-type':'application/json'},body:JSON.stringify({query:'{viewer{accounts(filter:{accountTag:"'+account+'"}){d1AnalyticsAdaptiveGroups(limit:10,filter:{date_geq:"'+new Date().toISOString().slice(0,10)+'",date_leq:"'+new Date().toISOString().slice(0,10)+'"}){sum{rowsRead rowsWritten} dimensions{databaseId}}}}}'})});const v=await response.json();result.d1=v.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups||v.errors;}catch(error){result.analyticsError=error.message}
await fs.mkdir(output,{recursive:true});await fs.writeFile(output+'/health-latest.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
