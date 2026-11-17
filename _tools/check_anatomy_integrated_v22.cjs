const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.HELIX_V22_URL||'http://127.0.0.1:8130',out='D:/workspace/codex_list/output/zhijing-v22/verification';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v22-integrated-atlas-chrome']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('.bin.gz'))requests.push(request.url());});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor();
  await page.evaluate(()=>goto('anatomy'));const start=Date.now();await page.locator('#anatomyStage[data-ready=true]').waitFor({timeout:60000});const liteMs=Date.now()-start;
  assert.ok(requests.every(url=>url.includes('/lite.bin.gz')));assert.equal(await page.evaluate(()=>AnatomyUI.viewer.refinedCount),0);
  await page.screenshot({path:out+'/anatomy-integrated-desktop.png',fullPage:true});
  await page.locator('[data-preset=heart]').click();await page.waitForFunction(()=>AnatomyUI.viewer?.refinedCount>0&&document.querySelector('#anatomyStage').dataset.ready==='true',{timeout:60000});
  const refined=await page.evaluate(()=>AnatomyUI.viewer.refinedCount);assert.ok(requests.length<10);const afterOrgan=requests.length;
  await page.locator('#anatomyReset').click();await page.locator('#anatomyStage[data-ready=true]').waitFor();assert.equal(requests.length,afterOrgan);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/anatomy-integrated-mobile.png',fullPage:true});
  requests.length=0;await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof state!=='undefined'&&typeof goto==='function');await page.evaluate(()=>{if(state.step!=='anatomy')goto('anatomy');});await page.locator('#anatomyStage[data-ready=true]').waitFor({timeout:60000});assert.equal(requests.length,0,'repeat entry should reuse persistent geometry without downloading');
  assert.deepEqual(errors,[]);const result={base,liteMs,refined,errors,checks:['full-body-lite-first','heart-refinement','reset-without-download','mobile-layout','reload-persistent-model-cache']};await fs.writeFile(out+'/anatomy-integrated.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
