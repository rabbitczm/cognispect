const fs=require('fs'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.ZHIJING_V26_URL||'http://127.0.0.1:8136',out='D:/workspace/codex_list/output/zhijing-v26';
const abstract='In this survival analysis, HR denotes hazard ratio. The HR was 0.72 (95% CI 0.61–0.85). There was no statistically significant difference between groups.';
(async()=>{
 const {providerRoute}=await import('../cloud/providers.js');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v26-reader-cache']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/translation/status',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({configured:true,provider:'Cloudflare AI',model:'medical-test',version:'v26',glossary_version:'v26'})}));
  await page.route('**/api/translation',async route=>{const body=route.request().postDataJSON();requests.push(body);assert.equal(body.context,abstract);assert.equal(body.title,'Contextual medical translation reading test');assert.equal(body.key,'');
   const result=await providerRoute(new Request(base+'/api/translation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{AI:{run:async()=>({response:JSON.stringify({segments:body.segments.map(s=>({id:s.id,zh:s.text==='HR'?'风险比':s.en?.includes('0.72')?'风险比为0.72（95%置信区间0.61–0.85）。':s.en?.includes('no statistically')?'组间差异无统计学意义。':'在此生存分析中，HR表示风险比。'}))})})}});
   await route.fulfill({status:result.status,contentType:'application/json',body:await result.text()});});
  await context.request.post(base+'/api/auth/login',{data:{username:'owner-preview',password:'preview-test-only-2026'}});
  await page.goto(base);await page.locator('#qInput').waitFor();await page.waitForFunction(()=>PersonalStore.user&&PersonalStore.ready);
  const open=()=>page.evaluate(async text=>{if(!LIB.some(d=>d.key==='translation-ui-v26'))LIB.push({key:'translation-ui-v26',pmid:'',title:'Contextual medical translation reading test',authors:'Reader',journal:'Reading workflow',year:'2026'});ABS['translation-ui-v26']=text;await ReaderUI.open('translation-ui-v26');},abstract);
  await open();
  await page.evaluate(()=>{for(const row of ReaderUI.segments())delete row.zh;PersonalStore.setItem('helix.translation.translation-ui-v26',JSON.stringify({source:ABS['translation-ui-v26'],segments:{},selections:[]}));renderMain();});
  await page.locator('[data-translate-segment]').nth(1).click();await page.waitForFunction(()=>ReaderUI.segments()[1].zh.includes('0.72'));
  assert.equal(await page.locator('[data-translation-cell=s1] [data-reader-lang=zh]').count(),1);
  await page.locator('[data-translation-edit="segment:s1"]').click();await page.locator('.reader-translation-editor').fill('我的风险比译文：0.72（95%置信区间0.61–0.85）。');await page.getByRole('button',{name:'保存修订',exact:true}).click();
  await page.locator('[data-translation-retry="segment:s1"]').click();await page.waitForFunction(()=>!document.querySelector('.reader-translation-progress'));assert.match(await page.locator('[data-translation-cell=s1] [data-reader-lang=zh]').innerText(),/我的风险比译文/);
  await page.evaluate(()=>{const el=document.querySelector('[data-reader-lang=en][data-segment=s1]'),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),node=walker.nextNode(),start=node.textContent.indexOf('HR'),range=document.createRange();range.setStart(node,start);range.setEnd(node,start+2);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.waitForFunction(()=>ReaderUI.state.selection?.text==='HR');await page.locator('#quickTranslate').click();await page.waitForFunction(()=>ReaderTranslation.data('translation-ui-v26').selections.length===1);
  const selected=await page.evaluate(()=>ReaderTranslation.data('translation-ui-v26').selections[0]);assert.equal(selected.zh,'风险比');assert.ok(requests.at(-1).segments[0].sentence.includes('95% CI'));
  assert.equal(await page.locator('[data-translation-cell=s1] [data-translation-card]').count(),2);await page.locator('[data-translation-card="'+selected.id+'"] .reader-translation-output').click();assert.equal(await page.evaluate(()=>getSelection().toString()),'HR');
  await page.evaluate(()=>PersonalStore.flush());await page.reload();await page.waitForFunction(()=>PersonalStore.user&&PersonalStore.ready&&typeof ReaderTranslation!=='undefined');await open();assert.match(await page.locator('[data-translation-cell=s1]').innerText(),/我的风险比译文/);assert.equal(await page.locator('[data-translation-card="'+selected.id+'"]').count(),1);
  fs.mkdirSync(out,{recursive:true});await page.screenshot({path:out+'/translation-desktop.png'});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('[data-translation-cell=s1]').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/translation-mobile.png'});
  await page.locator('[data-translation-delete="'+selected.id+'"]').click();assert.equal(await page.locator('[data-translation-card="'+selected.id+'"]').count(),0);await page.locator('#readerTranslateAll').click();await page.waitForFunction(()=>ReaderUI.segments().every(s=>s.zh));
  assert.deepEqual(errors,[]);const report={base,checks:['no-personal-key','full-context-and-title','paragraph-adjacent','personal-revision-survives-retranslation','selection-sentence-context','selection-anchor','reload-account-save','mobile-layout','delete','whole-abstract'],requests:requests.length,errors};fs.writeFileSync(out+'/reader-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
