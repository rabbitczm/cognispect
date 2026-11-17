import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {medicalTranslation} from '../cloud/medical-translation.js';
const require=createRequire(import.meta.url),{ProxyAgent}=require('D:/workspace/codex_list/tools/helix-wrangler/node_modules/undici');
const cases=JSON.parse(await fs.readFile('data/medical-translation-cases-v26.json','utf8')),agent=new ProxyAgent({uri:'http://127.0.0.1:7890',requestTls:{maxVersion:'TLSv1.2'}}),out='D:/workspace/codex_list/output/zhijing-v26';await fs.mkdir(out,{recursive:true});
let results=[];try{results=JSON.parse(await fs.readFile(out+'/medical-quality.json','utf8')).results||[];}catch{}
try{
 for(const item of cases){
  if(results.some(r=>r.id===item.id&&r.passed))continue;
  const auth=await fs.readFile('D:/workspace/codex_list/scratch/config/.wrangler/config/default.toml','utf8'),token=auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  const env={AI:{run:async(model,input)=>{let r;for(let attempt=0;attempt<4;attempt++){try{r=await fetch('https://api.cloudflare.com/client/v4/accounts/224da9da8bb5e6f533827b62e7726ba6/ai/run/'+model,{dispatcher:agent,method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(90000)});break;}catch(error){if(attempt===3)throw error;}}const value=await r.json();if(!r.ok||!value.success)throw Error('Cloudflare '+r.status+' '+JSON.stringify(value.errors));return value.result;}}};
  const r=await medicalTranslation({title:'Medical translation acceptance: '+item.id,context:item.context+' '+item.text,segments:[{id:item.id,en:item.text,sentence:item.text}],target:'ZH'},env),value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));
  const text=value.segments[0].zh,missing=item.expected.filter(s=>!new RegExp(s,'i').test(text)),wrong=(item.forbidden||[]).filter(s=>text.includes(s)),result={...item,translation:text,checks:value.segments[0].checks,missing,wrong,passed:!missing.length&&!wrong.length&&!value.segments[0].checks.length};
  results=results.filter(r=>r.id!==item.id);results.push(result);await fs.writeFile(out+'/medical-quality.json',JSON.stringify({model:value.model,checkedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify(result));
 }
 if(results.length!==20||results.some(r=>!r.passed))process.exitCode=1;
}finally{await agent.close();}
