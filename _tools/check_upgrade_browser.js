const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HELIX_PLAYWRIGHT_MODULE);
const out=process.env.HELIX_CHECK_OUTPUT,url=process.env.HELIX_URL;
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir='+path.join(out,'cache')]});
 const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(url);await page.locator('#introStage').waitFor();
  await page.waitForFunction(()=>window.IntroAnatomy?.meshes?.length>0&&document.querySelector('#introStage canvas')?.width>0&&document.querySelector('#introStatus')?.hidden);
  await page.locator('#introEnter').click();await page.waitForFunction(()=>typeof PersonalStore!=='undefined'&&PersonalStore.ready);
  const input=page.locator('#qInput');await input.focus();
  await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='肺结节';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await page.waitForTimeout(400);assert.equal(await input.inputValue(),'肺结节');assert.ok(await input.evaluate(el=>el===document.activeElement));
  await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  await page.waitForTimeout(400);assert.equal(await input.inputValue(),'肺结节');
  await page.evaluate(()=>goto('res'));await page.goBack();assert.equal(await page.evaluate(()=>state.step),'search');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'search-mobile.png'),fullPage:true});
  await page.evaluate(()=>goto('intro'));await page.locator('#introStage').waitFor();await page.screenshot({path:path.join(out,'intro-mobile.png'),fullPage:true});
  if(process.env.HELIX_CHECK_ATLAS==='1'){
   await page.evaluate(()=>goto('anatomy'));await page.locator('#anatomyStage[data-ready=true]').waitFor({timeout:90000});
   assert.ok(await page.locator('#anatomyStage canvas').evaluate(el=>el.width>0));
   await page.screenshot({path:path.join(out,'atlas-mobile.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS first visit, mobile Chinese IME, navigation, layout');
 } finally {await browser.close();fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({errors},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1});
