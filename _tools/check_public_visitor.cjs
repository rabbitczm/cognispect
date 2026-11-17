const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const url=process.env.HELIX_PUBLIC_URL||'https://cognispect.pages.dev';
const out=process.env.HELIX_PUBLIC_OUTPUT||'D:/workspace/codex_list/output/zhijing-cloud/verification/public-round3';
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',...(process.env.HELIX_BROWSER_PROXY?{proxy:{server:process.env.HELIX_BROWSER_PROXY}}:{}),args:['--disk-cache-dir='+path.join(out,'browser-cache')]}),page=await browser.newPage({viewport:{width:390,height:844}}),checks=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let ime;
 try{
  await page.goto(url+'/?intro=done#search',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>typeof LIB!=='undefined'&&LIB.length>=2310&&typeof PersonalStore!=='undefined'&&PersonalStore.ready,null,{timeout:90000});
  const input=page.locator('#qInput');await input.focus();
  await input.evaluate(el=>{window.__imeInput=el;window.__imeEvents=[];for(const type of ['compositionstart','compositionupdate','compositionend','input'])el.addEventListener(type,e=>window.__imeEvents.push({type:e.type,isComposing:e.isComposing,data:e.data}));});
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'肺结节',selectionStart:3,selectionEnd:3});
  await page.waitForTimeout(300);assert.ok(await input.evaluate(el=>el===window.__imeInput&&document.activeElement===el&&el.value==='肺结节'));
  await cdp.send('Input.insertText',{text:'肺结节'});await page.waitForTimeout(2000);
  ime=await page.evaluate(()=>({q:SRCH.q,value:document.querySelector('#qInput').value,same:window.__imeInput===document.querySelector('#qInput'),focused:document.activeElement===document.querySelector('#qInput'),libraryCount:LIB.length,events:window.__imeEvents}));
  assert.equal(ime.q,'肺结节','IME commit must automatically search without pressing Enter');assert.equal(ime.value,'肺结节');assert.ok(ime.same&&ime.focused);checks.push('mobile-chinese-ime-automatic-search');
  await input.fill('');await page.waitForFunction(()=>SRCH.q==='');
  await page.locator('#searchFilterToggle').click();await page.locator('[data-filter-section="years"] summary').click();
  await page.locator('#yearRangeFrom').fill('2020');await page.locator('#yearRangeTo').fill('2024');await page.locator('#applyYearRange').click();
  assert.deepEqual(await page.evaluate(()=>[SRCH.yearFrom,SRCH.yearTo]),[2020,2024]);
  assert.equal(await page.locator('#yearRangeFrom').inputValue(),'2020');assert.equal(await page.locator('#yearRangeTo').inputValue(),'2024');checks.push('year-range-filter');
  await page.screenshot({path:path.join(out,'search-year-mobile.png'),fullPage:true});
  for(const asset of ['/__private_assets','/__private_assets/manifest.json','/__private_assets/site/main.bin','/__private_assets/runtime/catalog.json','/__private_assets/assets/anatomy/muscles.js.part-0000'])assert.equal(await page.evaluate(async p=>(await fetch(p)).status,asset),404,asset);
  checks.push('internal-assets-404');assert.deepEqual(errors,[]);console.log(JSON.stringify({url,checks,errors,ime},null,2));
 }finally{fs.writeFileSync(path.join(out,'public-visitor.json'),JSON.stringify({url,checks,errors,ime},null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
