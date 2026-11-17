const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disk-cache-dir=D:/workspace/codex_list/scratch/browser-cache-v21']});
 try{
  const page=await browser.newPage();
  const html=await fs.readFile('scratch/cloud-site/__private_assets/site/main.bin','utf8');
  const docs=Array.from({length:100},(_,i)=>({key:String(i+1),pmid:String(i+1),title:'Lung cancer research '+(i+1),authors:'Research Team',journal:'Medical Journal',year:'2024',firstdate:'2024-01-01',topics:[],level:1,cited:0}));
  const pageData=(offset=0,limit=40)=>({docs:docs.slice(offset,offset+limit),abstracts:{},translations:{},translation_sources:{},focus:{},verify:{},total:100,next:offset+limit<100?offset+limit:null,version});
  let release,libraryRequests=0,version="loading-test:1",offsets=[];const background=new Promise(r=>release=r);
  await page.route('https://loading.test/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(url.pathname==='/api/site')return route.fulfill({json:{name:'知镜',modules:[]}});
   if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:false,auth_mode:'password'}});
   if(url.pathname==='/api/library/meta')return route.fulfill({json:{version}});
   if(url.pathname==='/api/library/index'){await background;return route.fulfill({json:{docs,total:100,version}});}
   if(url.pathname==='/api/library'){
    libraryRequests++;offsets.push(Number(url.searchParams.get('offset')||0));
    const offset=Number(url.searchParams.get('offset')||0);
    if(offset)await background;
    return route.fulfill({json:pageData(offset,Number(url.searchParams.get('limit')||40))});
   }
   if(url.pathname.startsWith('/assets/')){
    try{return route.fulfill({body:await fs.readFile('scratch/cloud-site'+url.pathname),contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css'});}catch{}
   }
   return route.fulfill({json:{records:[],documents:[]}});
  });
  await page.goto('https://loading.test/',{waitUntil:'domcontentloaded'});
  try{
   await page.locator('#qInput').waitFor({state:'visible',timeout:4000});
   assert.equal(await page.evaluate(()=>LIB.length),20,'first screen must be usable before the remaining corpus arrives');
  }finally{release();}
  await page.waitForFunction(()=>LIB.length===100);
  assert.equal((await page.context().cookies()).length,0,'guest entry must not set cookies');
  await page.locator('#qInput').fill('lung');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.hit').count(),20);
  await page.locator('[data-page="2"]').first().click();
  assert.equal(await page.locator('.hit').count(),20);
  assert.equal(await page.evaluate(()=>SRCH.page),2);
  await page.locator('#searchPageNumber').fill('4');
  await page.locator('#searchPageJump button').click();
  assert.equal(await page.evaluate(()=>SRCH.page),4);
  assert.equal(await page.locator('.hit').count(),20);
  await page.locator('#searchPageNumber').fill('3');
  await page.locator('#searchPageNumber').press('Enter');
  assert.equal(await page.evaluate(()=>SRCH.page),3);
  await page.locator('#searchPageNumber').fill('6');
  await page.locator('#searchPageJump button').click();
  assert.equal(await page.evaluate(()=>SRCH.page),3,'an unavailable page should leave the current results in place');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#searchPageNumber').fill('5');
  await page.locator('#searchPageNumber').press('Enter');
  assert.equal(await page.evaluate(()=>SRCH.page),5);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page jump fits the mobile layout');
  assert.equal(await page.locator('#searchLoadMore').count(),0);
  await page.waitForFunction(()=>LibraryUI.complete);
  await page.waitForTimeout(1000);
  const requestsBefore=libraryRequests;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#qInput').waitFor();
  assert.equal(libraryRequests,requestsBefore,'a repeat visit must reuse the validated public cache');
  await page.evaluate(async()=>{const cached=await PublicCache.get('library');cached.complete=false;cached.nextOffset=60;await PublicCache.put('library',cached);await PublicCache.put('asset:kept-model',{version:'model-1',blob:new Blob(['model'])});});
  offsets=[];await page.reload({waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor();await page.waitForFunction(()=>LibraryUI.complete);assert.deepEqual(offsets,[60],'an interrupted background download resumes from its saved offset');
  version='loading-test:2';await page.reload({waitUntil:'domcontentloaded'});await page.locator('#qInput').waitFor();assert.equal(await page.evaluate(async()=>!!await PublicCache.get('asset:kept-model')),true,'catalog invalidation preserves independently versioned model cache');
  console.log('PASS: first 20 usable with numbered pagination, background corpus, no guest cookies, search and repeat-visit cache');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

