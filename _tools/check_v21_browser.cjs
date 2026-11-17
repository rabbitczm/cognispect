const fs=require('node:fs/promises'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.HELIX_V21_URL||'http://127.0.0.1:8121';
const out='D:/workspace/codex_list/output/zhijing-v21/verification';
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disk-cache-dir=D:/workspace/codex_list/scratch/browser-v21-check']});
 const errors=[],checks=[],timing={};
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',err=>errors.push(err.message));
 try{
  const start=Date.now();await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor({timeout:60000});timing.firstUsableMs=Date.now()-start;
  assert.equal((await context.cookies()).length,0);checks.push('guest-no-cookies');
  await page.waitForFunction(()=>LibraryUI.indexReady,{timeout:60000});
  await page.locator('#qInput').evaluate(input=>{input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='肺结节';input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'肺结节',isComposing:true}));input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'肺结节'}));});
  await page.waitForTimeout(550);assert.ok(await page.locator('.hit').count());checks.push('chinese-search');
  await page.locator('#qClear').click();await page.locator('#searchFilterToggle').click();assert.ok(await page.locator('#searchFilters').isVisible());
  await page.screenshot({path:path.join(out,'desktop-search.png'),fullPage:true});
  await page.evaluate(()=>goto('reader'));await page.locator('#rwTab-notes').waitFor();assert.equal(await page.locator('.reader-sidebar #readerLogin').count(),0);
  const note=page.locator('#readerNote');await page.locator('[data-note-edit="readerNote"]').click();await note.fill('游客临时笔记');await page.locator('#readerSave').click();
  await page.evaluate(()=>goto('search'));await page.evaluate(()=>goto('reader'));await page.locator('[data-note-edit="readerNote"]').click();assert.equal(await note.inputValue(),'游客临时笔记');checks.push('guest-temporary-notes');
  await page.locator('#accountButton').click();await page.locator('#accountForm [name=username]').fill('owner-preview');await page.locator('#accountForm [name=password]').fill('preview-test-only-2026');await page.locator('#accountForm [type=submit]').click();
  await page.waitForFunction(()=>PersonalStore.user?.role==='owner',{timeout:15000});checks.push('password-login-from-reader');
  await page.locator('#readerNote').waitFor();await page.locator('[data-note-edit="readerNote"]').click();await page.locator('#readerNote').fill('研究问题：影像数据如何支持结节分析？');await page.locator('#readerSave').click();
  await page.locator('#rwCollaboration .rw-note-meta').waitFor({timeout:15000});
  await page.locator('#rwCollaboration details').filter({hasText:'邀请与访问权限'}).locator('summary').click();
  await page.locator('#rwInviteUsername').fill('reviewer-preview');await page.locator('#rwInviteForm [type=submit]').click();await page.getByText('reviewer-preview',{exact:true}).waitFor({state:'attached'});checks.push('note-save-and-invite');
  await page.evaluate(()=>document.querySelector('#main').scrollTop=0);await page.screenshot({path:path.join(out,'desktop-reader.png'),fullPage:true});
  await page.evaluate(()=>{goto('search');SRCH.scope='mine';renderMain();});await page.locator('#myPaperQuery').waitFor();checks.push('my-papers-tab');
  await page.evaluate(()=>goto('pdf'));await page.locator('#pdfFile').setInputFiles('D:/workspace/codex_list/output/zhijing-cloud/verification/compute/table.pdf');await page.locator('#pdfTableToStats').waitFor({timeout:120000});
  assert.ok(await page.locator('#rwPdfTools').count());checks.push('private-pdf-and-reading-tools');
  await page.evaluate(()=>{goto('search');SRCH.scope='mine';renderMain();});await page.getByText('Group Before After',{exact:true}).first().waitFor({timeout:15000});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-my-papers.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push('mobile-no-horizontal-overflow');
  await page.evaluate(()=>goto('reader'));await page.locator('#rwDrawerToggle').click();await page.locator('#rwTab-notes').waitFor({state:'visible'});await page.screenshot({path:path.join(out,'mobile-reader.png'),fullPage:true});checks.push('mobile-reading-drawer');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'browser.json'),JSON.stringify({base,checks,timing,errors},null,2));console.log(JSON.stringify({checks,timing,errors}));
 }catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(JSON.stringify({checks,timing,errors}));throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
