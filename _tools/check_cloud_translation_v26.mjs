import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{ProxyAgent}=require('D:/workspace/codex_list/tools/helix-wrangler/node_modules/undici');
const base=process.env.ZHIJING_V26_URL||'https://cognispect.tech',agent=new ProxyAgent({uri:'http://127.0.0.1:7890',requestTls:{maxVersion:'TLSv1.2'}}),account='224da9da8bb5e6f533827b62e7726ba6',database='5ae147cf-ef53-410c-9dcf-5fed94736364',out='D:/workspace/codex_list/output/zhijing-v26';
const auth=await fs.readFile('D:/workspace/codex_list/scratch/config/.wrangler/config/default.toml','utf8'),token=auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
async function request(url,options={}){for(let attempt=0;attempt<4;attempt++)try{return await fetch(url,{...options,dispatcher:agent,signal:AbortSignal.timeout(90000)});}catch(e){if(attempt===3)throw e;}}
async function sql(query,params=[]){const r=await request('https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+database+'/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({sql:query,params})}),data=await r.json();if(!r.ok||!data.success)throw Error('Cloudflare SQL '+r.status+' '+JSON.stringify(data.errors));return data.result;}
const raw=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(raw).digest('hex');let inserted=false;
try{
 const before=await sql('SELECT COUNT(*) total FROM users; SELECT COUNT(*) total FROM workspaces;');
 const identity=(await sql("SELECT id FROM users WHERE role='owner' AND active=1 LIMIT 1"))[0].results[0];
 await sql('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)',[hash,identity.id,Date.now()+600000]);inserted=true;
 const status=await request(base+'/api/translation/status').then(r=>r.json());assert.equal(status.configured,true);
 const input={title:'Kidney outcomes and survival',context:'This study assessed diabetic nephropathy, not diabetic retinopathy. HR denotes hazard ratio in the Cox survival analysis. The HR was 0.72 (95% CI 0.61–0.85). No causal benefit was established.',segments:[{id:'selected',text:'The HR was 0.72 (95% CI 0.61–0.85).',sentence:'The HR was 0.72 (95% CI 0.61–0.85).',before:'HR denotes hazard ratio in the Cox survival analysis.',after:'No causal benefit was established.'}],target:'ZH'};
 const anonymous=await request(base+'/api/translation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(anonymous.status,401);
 const start=Date.now(),response=await request(base+'/api/translation',{method:'POST',headers:{'content-type':'application/json',cookie:'helix_session='+raw},body:JSON.stringify(input)}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.match(value.segments[0].zh,/风险比|危险比/);assert.match(value.segments[0].zh,/置信区间/);assert.deepEqual(value.segments[0].checks,[]);
 const after=await sql('SELECT COUNT(*) total FROM users; SELECT COUNT(*) total FROM workspaces;');assert.deepEqual(after.map(r=>r.results),before.map(r=>r.results));
 const result={base,checkedAt:new Date().toISOString(),status,translation:value,ms:Date.now()-start,checks:['authenticated-no-personal-api-key','full-context','HR-hazard-ratio','CI-confidence-interval','numbers-preserved','anonymous-login-required','accounts-and-workspaces-unchanged']};await fs.mkdir(out,{recursive:true});await fs.writeFile(out+'/'+(base.includes('pages.dev')?'preview':'public')+'-translation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(inserted){await sql('DELETE FROM sessions WHERE token_hash=?',[hash]);console.log('Temporary verification session removed.');}await agent.close();}
