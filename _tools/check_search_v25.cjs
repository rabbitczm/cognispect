const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.ZHIJING_V25_URL||'http://127.0.0.1:8136';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',proxy:process.env.ZHIJING_BROWSER_PROXY?{server:process.env.ZHIJING_BROWSER_PROXY}:undefined,args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v25-search-browser','--ssl-version-max=tls1.2']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor();
  await page.waitForFunction(()=>CATALOG_SEARCH.total>=20000&&!CATALOG_SEARCH.loading);
  const search=async query=>{await page.locator('#qInput').fill(query);await page.locator('#qGo').click();await page.waitForFunction(q=>SRCH.q===q&&!CATALOG_SEARCH.loading&&!CATALOG_SEARCH.error&&CATALOG_SEARCH.docs.length>0,query);return page.evaluate(()=>CATALOG_SEARCH.docs.map(d=>({key:d.key,title:d.title,date:d.firstdate,doi:d.doi})));};
  const english=await search('diabetic nephropathy');assert.match(english[0].title,/nephropath|kidney|renal/i);
  const chinese=await search('糖尿病肾病');assert.deepEqual(chinese.map(d=>d.key),english.map(d=>d.key),'Chinese and English resolve to the same disease');
  await page.locator('#qSortQuick').selectOption('year');await page.waitForFunction(()=>!CATALOG_SEARCH.loading&&JSON.parse(CATALOG_SEARCH.signature).sort==='year');
  const dates=await page.evaluate(()=>CATALOG_SEARCH.docs.map(d=>d.firstdate||d.year));assert.deepEqual(dates,[...dates].sort().reverse());
  await page.locator('#searchHistory details').nth(1).locator('summary').click();await page.locator('#searchSaveCurrent').click();await page.locator('#searchSavedName').fill('糖尿病肾病');await page.locator('#searchSaveConfirm').click();
  await page.locator('[data-search-saved="糖尿病肾病"]').waitFor();
  await page.locator('#qClear').click();await page.waitForFunction(()=>!CATALOG_SEARCH.loading&&CATALOG_SEARCH.total>=20000&&SRCH.q==='');
  await page.locator('#searchPageNumber').fill('110');await page.locator('#searchPageJump button').click();
  await page.waitForFunction(()=>!CATALOG_SEARCH.loading&&JSON.parse(CATALOG_SEARCH.signature).page===110);
  assert.equal(await page.locator('.hit').count(),20,'page navigation keeps 20 results');
  assert.ok(await page.evaluate(()=>LIB.length<=2000),'background prefetch is bounded to 2,000 papers');
  const selected=await page.evaluate(()=>CATALOG_SEARCH.docs.find(d=>d.abstract&&!LIB.some(p=>p.key===d.key))?.key);
  assert.ok(selected,'page beyond prefetch includes an uncached readable paper');
  await page.evaluate(key=>ReaderUI.open(key),selected);await page.waitForFunction(key=>state.step==='reader'&&ReaderUI.state.key===key,selected);
  assert.ok((await page.locator('#readerAbstract').innerText()).trim().length>50,'the selected paper opens in the reader');
  await page.evaluate(()=>goto('search'));
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor();await page.locator('#searchHistory details').nth(1).locator('summary').click();await page.locator('[data-search-saved="糖尿病肾病"]').waitFor();
  await page.locator('[data-search-saved="糖尿病肾病"]').click();await page.waitForFunction(()=>!CATALOG_SEARCH.loading&&SRCH.q==='糖尿病肾病');
  assert.equal((await context.cookies()).length,0,'guest history must not create cookies');
  if(new URL(base).hostname==='127.0.0.1'){
   const login=await context.request.post(base+'/api/auth/login',{data:{username:'owner-preview',password:'preview-test-only-2026'}});assert.equal(login.status(),200);
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor();await page.locator('#searchHistory details').nth(1).locator('summary').click();await page.locator('#searchImportLocal').waitFor();await page.locator('#searchImportLocal').click();await page.locator('[data-search-saved="糖尿病肾病"]').waitFor();
   const saved=await page.evaluate(()=>JSON.parse(PersonalStore.getItem('helix.search.saved.v25')||'[]'));assert.ok(saved.some(d=>d.name==='糖尿病肾病'));
  }
  fs.mkdirSync('D:/workspace/codex_list/output/zhijing-v25',{recursive:true});await page.locator('.search-results').scrollIntoViewIfNeeded();await page.screenshot({path:'D:/workspace/codex_list/output/zhijing-v25/mobile-search.png'});
  assert.deepEqual(errors,[]);const report={base,checks:['disease-cross-language-results','newest-date-sort','named-search-save-reload','page-110-on-demand','20-results-per-page','prefetch-at-most-2000','uncached-paper-opens-in-reader','guest-no-cookie',...(new URL(base).hostname==='127.0.0.1'?['guest-to-account-merge']:[])],errors};fs.writeFileSync('D:/workspace/codex_list/output/zhijing-v25/'+(new URL(base).hostname==='127.0.0.1'?'local':'public')+'-mobile-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
