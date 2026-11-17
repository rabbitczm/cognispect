const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.HELIX_PUBLIC_V21||'https://v21-preview.cognispect.pages.dev',out='D:/workspace/codex_list/output/zhijing-v21/verification';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v21-public-chrome']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],checks=[],timing={};
  page.on('pageerror',e=>errors.push(e.message));
  const started=Date.now();await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('#qInput').waitFor({timeout:60000});timing.firstUsableMs=Date.now()-started;assert.equal((await context.cookies()).length,0);checks.push('public-mobile-guest-no-cookies');
  await page.waitForFunction(()=>LibraryUI.indexReady,{timeout:60000});await page.locator('#qInput').fill('肺结节');await page.waitForTimeout(600);assert.ok(await page.locator('.hit').count());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push('public-mobile-chinese-search');
  await page.screenshot({path:out+'/public-mobile-search.png',fullPage:true});
  await page.evaluate(()=>goto('anatomy'));await page.locator('#anatomyStage[data-ready=true]').waitFor({timeout:120000});checks.push('anatomy-lazy-interactive-load');
  await page.evaluate(()=>goto('reader'));await page.locator('#rwDrawerToggle').click();await page.locator('#rwTab-summary').click();await page.locator('#rwSummaryContent').waitFor();await page.screenshot({path:out+'/public-mobile-reader.png',fullPage:true});checks.push('public-mobile-reader-tools');
  assert.deepEqual(errors,[]);await fs.writeFile(out+'/public-browser.json',JSON.stringify({base,checks,timing,errors},null,2));console.log(JSON.stringify({checks,timing,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
