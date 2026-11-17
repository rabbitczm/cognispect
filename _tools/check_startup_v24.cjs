const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.ZHIJING_V24_URL||'http://127.0.0.1:8134',out='D:/workspace/codex_list/output/zhijing-v24';
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v24-startup-browser']});
 try{
  const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  const response=await page.request.get(base+'/api/bootstrap');assert.equal(response.status(),200,'one bootstrap request must supply the first page');
  const boot=await response.json();assert.equal(boot.library.docs.length,20);assert.ok(boot.site.modules);assert.equal(boot.session.authenticated,false);
  const unchanged=await (await page.request.get(base+'/api/bootstrap?version='+encodeURIComponent(boot.version))).json();assert.equal(unchanged.library,null,'unchanged version should not resend papers');
  await page.goto(base);await page.locator('#qInput').waitFor();
  assert.equal(requests.filter(u=>/\/api\/(site|library\/meta|auth\/session)(?:\?|$)/.test(u)).length,0,'startup should not repeat the combined requests');
  await page.waitForFunction(()=>LibraryUI.indexReady);await page.locator('#searchPageNumber').fill('2');await page.locator('#searchPageJump button').click();assert.equal(await page.evaluate(()=>SRCH.page),2);
  await page.locator('#qInput').fill('肺');await page.locator('#qInput').press('Enter');assert.ok(await page.locator('.hit').count()>0);
  await page.waitForFunction(()=>LibraryUI.complete,{timeout:120000});await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);requests.length=0;
  await page.reload();await page.locator('#qInput').waitFor();assert.equal(requests.filter(u=>/\/api\/library(?:\?|\/index|\/document)/.test(u)).length,0,'refresh must reuse checked cached papers');
  assert.equal((await context.cookies()).length,0);
  if(!base.startsWith('https://')){
   const owner=await browser.newContext(),admin=await owner.newPage();
   let r=await admin.request.post(base+'/api/auth/login',{data:{username:'owner-preview',password:'preview-test-only-2026'}});assert.equal(r.status(),200);
   const key=boot.library.docs[0].key;await admin.request.post(base+'/api/admin/visibility',{data:{kind:'article',key,visible:false}});
   await page.reload();await page.locator('#qInput').waitFor();assert.equal(await page.evaluate(key=>LIB.some(d=>d.key===key),key),false,'hidden papers must be removed before cached content is shown');
   await admin.request.post(base+'/api/admin/visibility',{data:{kind:'article',key,visible:true}});
   const asset=base+'/assets/anatomy/start-v24/male.bin.gz?v=anatomy-start-v24.1';assert.equal((await page.request.get(asset)).status(),200);
   await admin.request.post(base+'/api/admin/visibility',{data:{kind:'module',key:'anatomy',visible:false}});await admin.request.post(base+'/api/admin/site/publish',{data:{}});
   assert.equal((await page.request.get(asset)).status(),404,'edge-cached geometry must still respect hidden module');
   await page.reload();await page.locator('#qInput').waitFor();assert.equal(await page.evaluate(()=>SiteUI.allowed('anatomy')),false);
   await admin.request.post(base+'/api/admin/visibility',{data:{kind:'module',key:'anatomy',visible:true}});await admin.request.post(base+'/api/admin/site/publish',{data:{}});await owner.close();
  }
  const caches=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const r of await (await caches.open(name)).keys())result.push(new URL(r.url).pathname);return result;});assert.ok(caches.includes('/'));assert.ok(caches.every(p=>!p.startsWith('/api/')&&!p.startsWith('/content/')));
  assert.deepEqual(errors,[]);const result={base,checks:['combined-startup','first-page20','unchanged-version-no-papers','page-jump','chinese-search','persistent-refresh','guest-no-cookies','visibility-after-refresh','shell-cache-no-private-responses'],errors};await fs.writeFile(out+'/startup.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
