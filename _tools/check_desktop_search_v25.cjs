const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const out='D:/workspace/codex_list/output/zhijing-v25';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v25-desktop-browser']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],results=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8136');await page.locator('#qInput').waitFor();
  for(const q of ['高血压','肺动脉高压','IgA肾病','膜性肾病','2型糖尿病']){
   await page.locator('#qInput').fill(q);await page.locator('#qGo').click();
   await page.waitForFunction(q=>!CATALOG_SEARCH.loading&&SRCH.q===q&&JSON.parse(CATALOG_SEARCH.signature).groups.flat().length>0,q);
   const result=await page.evaluate(()=>({query:SRCH.q,total:CATALOG_SEARCH.total,title:CATALOG_SEARCH.docs[0]?.title,error:CATALOG_SEARCH.error}));
   console.log(JSON.stringify(result));assert.ok(result.total>0);assert.ok(!result.error);
   if(q==='高血压')assert.doesNotMatch(result.title,/pulmonary|portal/i);
   results.push(result);
  }
  await page.evaluate(()=>goto('anatomy'));await page.locator('#anatomyStage[data-ready=true]').waitFor();
  await page.locator('[data-model=female]').click();await page.locator('#anatomyStage[data-ready=true][data-model=female]').waitFor();
  await page.waitForFunction(()=>!ANATOMY.preview);
  const count=await page.evaluate(()=>AnatomyUI.parts.FEMALE_breasts.elements.length);assert.equal(count,16);
  await page.locator('[data-structure=FEMALE_breasts]').first().click();
  await page.waitForFunction(()=>AnatomyUI.viewer.refinedCount>=16&&document.querySelector('#anatomyLoading').hidden);
  await page.locator('#anatomyIsolate').click();await page.waitForFunction(()=>document.querySelector('#anatomyLoading').hidden);
  fs.mkdirSync(out,{recursive:true});await page.screenshot({path:out+'/female-breast.png'});
  assert.deepEqual(errors,[]);fs.writeFileSync(out+'/desktop-acceptance.json',JSON.stringify({results,breastMeshes:count,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
