const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),output='D:/workspace/codex_list/output/zhijing-v23';
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const catalog=JSON.parse(await fs.readFile(path.join(root,'data/anatomy-catalog.json'),'utf8'));
 const knowledge=JSON.parse(await fs.readFile(path.join(root,'data/anatomy-knowledge.json'),'utf8'));
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;background:#edf2f0;font:14px sans-serif;--line:#bbb;--line2:#888;--accent:#246853;--tx2:#234;--tx3:#567;--surface2:#eee}.atlas-page{padding:15px}.work-head{display:flex;justify-content:space-between}.atlas-stage canvas{display:block;width:100%;height:100%}</style><link rel="stylesheet" href="/_lib/simulation.css"><link rel="stylesheet" href="/_lib/anatomy_open.css"><div id="main"></div><script>var ANATOMY=${JSON.stringify(catalog)},ANATOMY_KNOWLEDGE=${JSON.stringify(knowledge)},PersonalStore={user:null};var esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));</script><script src="/_lib/library_loading.js"></script><script src="/_lib/vendor/three-0.160.1.min.js"></script><script src="/_lib/anatomy_open_model.js"></script><script src="/_lib/anatomy_open_ui.js"></script><script>document.querySelector('#main').innerHTML=AnatomyUI.render();AnatomyUI.bind();</script>`);return;}
  let pathname=url.pathname;if(pathname==='/assets/anatomy/female-v23/catalog.json')pathname='/data/anatomy-female.json';
  const file=path.join(root,pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end('Missing');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v23-atlas-browser']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('.bin.gz'))requests.push(r.url());});
  const start=Date.now();await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#anatomyStage[data-ready=true]').waitFor({timeout:45000});
  const maleLiteMs=Date.now()-start;
  assert.equal(await page.locator('[data-mark-color]').count(),6,'selected organs must expose six persistent colour marks');
  await page.locator('[data-mark-color]').first().click();
  const maleColor=await page.evaluate(()=>AnatomyUI.viewer.markColor(ANATOMY.parts.FMA7088.elements[0]));assert.ok(maleColor);
  await page.locator('[data-view=back]').click();assert.equal(await page.evaluate(()=>AnatomyUI.viewer.markColor(ANATOMY.parts.FMA7088.elements[0])),maleColor);
  await page.reload();await page.locator('#anatomyStage[data-ready=true]').waitFor();assert.equal(await page.evaluate(()=>AnatomyUI.viewer.markColor(ANATOMY.parts.FMA7088.elements[0])),maleColor);
  await page.evaluate(()=>{PersonalStore.user={id:'other-user'};AnatomyUI.dispose();document.querySelector('#main').innerHTML=AnatomyUI.render();AnatomyUI.bind();});await page.locator('#anatomyStage[data-ready=true]').waitFor();assert.equal(await page.evaluate(()=>AnatomyUI.viewer.markColor(ANATOMY.parts.FMA7088.elements[0])),null);
  await page.locator('[data-model=female]').click();await page.locator('#anatomyStage[data-ready=true][data-model=female]').waitFor({timeout:60000});
  assert.equal(await page.locator('canvas').count(),1);assert.equal(await page.evaluate(()=>AnatomyUI.parts.VH_F_left_ovary!==undefined),true);
  await page.locator('#anatomySearch').fill('卵巢');assert.ok(await page.locator('.atlas-result').count()>0);
  await page.locator('.atlas-result').first().click();await page.locator('[data-mark-color]').nth(1).click();
  await page.waitForFunction(()=>AnatomyUI.viewer.refinedCount>0);assert.ok(await page.evaluate(()=>Object.keys(AnatomyUI.viewer.marks).length)>0);
  await page.locator('#anatomyReset').click();await page.locator('#anatomyStage[data-ready=true]').waitFor();
  const calls=await page.evaluate(()=>AnatomyUI.viewer.renderStats().calls);assert.ok(calls<80,'full-body preview should render in batches');
  await page.screenshot({path:output+'/female-atlas-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:output+'/female-atlas-mobile.png',fullPage:true});
  const before=requests.length;await page.reload();await page.locator('#anatomyStage[data-ready=true][data-model=female]').waitFor();assert.equal(requests.length,before,'reload should use persistent geometry cache');
  await page.locator('#anatomyClearMarks').click();assert.equal(await page.evaluate(()=>Object.keys(AnatomyUI.viewer.marks).length),0);
  await page.locator('[data-model=male]').click();await page.locator('#anatomyStage[data-ready=true][data-model=male]').waitFor();
  await page.locator('[data-model=female]').click();await page.locator('#anatomyStage[data-ready=true][data-model=female]').waitFor();
  await page.locator('#anatomyIsolate').click();await page.waitForFunction(()=>document.querySelector('#anatomyLoading').hidden);await page.locator('#anatomyStage').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/female-pick-target.png'});const box=await page.locator('#anatomyStage canvas').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForFunction(()=>document.querySelector('#anatomyDetail').dataset.selected!=='FMA7088');

  assert.deepEqual(errors,[]);const result={maleLiteMs,calls,requests,checks:['persistent-colours','account-isolation','sex-switch','female-chinese-search','organ-refinement','single-canvas','batched-render','mobile-layout','cached-reload'],errors};
  await fs.writeFile(output+'/anatomy.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
