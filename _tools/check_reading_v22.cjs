const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.HELIX_V22_URL||'http://127.0.0.1:8131',out='D:/workspace/codex_list/output/zhijing-v22/verification';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v22-reading-chrome']});
 try{
  await fs.mkdir(out,{recursive:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor();await page.waitForFunction(()=>LibraryUI.indexReady);assert.equal(await page.locator('.hit').count(),20);
  await page.locator('[data-page="2"]').first().click();assert.equal(await page.locator('.hit').count(),20);assert.equal(await page.evaluate(()=>SRCH.page),2);checks.push('20-per-page-numbered-navigation');
  await page.locator('#qInput').fill('肺结节');await page.waitForTimeout(500);assert.ok(await page.locator('.hit').count());checks.push('chinese-search');
  await page.evaluate(()=>ReaderUI.open('21452728'));await page.locator('.reader-text[data-reader-lang=en]').first().waitFor();
  await page.locator('.reader-text[data-reader-lang=en]').first().evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const text=walker.nextNode(),range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(25,text.length));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#readerMarkApply:not([disabled])').waitFor();await page.locator('#readerMarkApply').click();assert.equal(await page.locator('#readerDeleteActive').count(),1);
  await page.locator('#readerActiveColor').selectOption('blue');await page.locator('#readerDeleteActive').click();assert.equal(await page.locator('.reader-mark').count(),0);await page.locator('#readerUndo').click();assert.ok(await page.locator('.reader-mark').count());await page.locator('#readerRedo').click();assert.equal(await page.locator('.reader-mark').count(),0);checks.push('selection-delete-color-undo-redo');
  assert.equal(await page.locator('.rw-collaboration-wrap').getAttribute('open'),null);checks.push('collaboration-folded');
  await page.evaluate(()=>goto('pdf'));assert.ok(!(await page.locator('body').innerText()).includes('暂无 PDF。'));checks.push('pdf-clean-empty-state');
  await page.evaluate(()=>goto('reader'));await page.setViewportSize({width:390,height:844});await page.locator('#rwDrawerToggle').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/reading-mobile.png',fullPage:true});checks.push('mobile-reading-tools');
  assert.equal((await context.cookies()).length,0);assert.deepEqual(errors,[]);const result={base,checks,errors};await fs.writeFile(out+'/reading.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
