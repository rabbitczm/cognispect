const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HELIX_PLAYWRIGHT_MODULE);
const out=process.env.HELIX_CHECK_OUTPUT,url=process.env.HELIX_URL||'http://127.0.0.1:8097';
const cloud=process.env.HELIX_CHECK_CLOUD==='1';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir='+path.join(out,'owner-cache')]}),errors=[],checks=[];
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 async function login(who){
  await page.locator('#username').fill(who+'@example.org');
  if(cloud){await page.locator('#sendAdminCode').click();await page.getByText('验证码已发送，请检查邮箱。',{exact:true}).waitFor();await page.locator('#adminCode').fill('606060');await page.locator('#otpAdminForm button:not([type=button])').click();}
  else{await page.locator('#password').fill(who==='owner'?'owner-password-19':'admin-password-18');await page.locator('#loginForm button').click();}
 }
 try{
  await page.goto(url+'/?intro=done#search');await page.waitForFunction(()=>typeof PersonalStore!=='undefined'&&PersonalStore.ready&&LIB.length>0);
  assert.equal(await page.evaluate(()=>new Set(LIB.map(d=>d.key)).size),await page.evaluate(()=>LIB.length));
  assert.ok(await page.evaluate(()=>Object.keys(DOCS).length>0));
  await page.locator('#searchFilterToggle').click();assert.equal(await page.locator('[data-filter-section=years]').getAttribute('open'),null);
  await page.locator('[data-filter-section=years] summary').click();await page.locator('[data-year-preset="3"]').click();
  assert.equal(await page.evaluate(()=>SRCH.yearFrom),new Date().getFullYear()-2);assert.ok(await page.evaluate(()=>sHits(sWords(SRCH.q)).every(x=>+publicationYear(x.d)>=SRCH.yearFrom)));
  await page.locator('#qClear').click();assert.equal(await page.evaluate(()=>SRCH.yearFrom),0);
  assert.equal(await page.locator('#navList [data-jump=medical]').count(),0);assert.equal(await page.locator('#navList [data-jump=intro]').count(),0);
  checks.push('年份折叠、快捷区间、清空与导航归并');
  await page.goto(url+'/admin');await login('owner');
  await page.locator('[data-tab=owner]').click();await page.locator('#adminLimit').fill('1');await page.locator('#adminLimitForm button').click();await page.getByText('管理员名额已保存。',{exact:true}).waitFor();
  await page.locator('[data-tab=site]').click();await page.locator('[name=hero_title]').fill('从证据出发，完成一次复现');await page.locator('#siteForm button[type=submit],#siteForm button:not([type])').first().click();
  await page.getByText('草稿已保存，可先预览网页。',{exact:true}).waitFor();
  assert.notEqual(await page.evaluate(async()=> (await(await fetch('/api/site')).json()).hero_title),'从证据出发，完成一次复现');
  await page.locator('#sitePublish').click();await page.getByText('已发布，访客刷新即可看到。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=> (await(await fetch('/api/site')).json()).hero_title),'从证据出发，完成一次复现');
  await page.screenshot({path:path.join(out,'owner-site-desktop.png'),fullPage:true});
  await page.locator('#visibilityForm [name=key]').fill('25554246');await page.locator('#visibilityForm button').click();await page.getByText('公开状态已更新。',{exact:true}).waitFor();
  const guest=await browser.newContext({viewport:{width:390,height:844}}),g=await guest.newPage();await g.goto(url+'/?intro=done#search');await g.waitForFunction(()=>typeof PersonalStore!=='undefined'&&PersonalStore.ready&&LIB.length>0);
  assert.equal(await g.evaluate(()=>LIB.some(d=>d.key==='25554246')),false);
  assert.equal((await g.request.get(url+'/api/publications/25554246')).status(),404);
  await g.locator('#searchFilterToggle').click();await g.locator('[data-filter-section=years] summary').click();assert.ok(await g.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await g.screenshot({path:path.join(out,'filters-mobile.png'),fullPage:true});await guest.close();
  await page.locator('[data-restore-key="25554246"]').click();await page.locator('#siteRestore').click();await page.getByText('已恢复上一发布版本。',{exact:true}).waitFor();
  checks.push('站主设置名额、草稿/发布/恢复、隐藏内容与手机筛选');
  await page.locator('#logout').click();await login('admin');await page.locator('[data-tab=articles]').waitFor();assert.equal(await page.locator('[data-tab=site]').count(),0);
  assert.equal((await page.request.put(url+'/api/admin/site',{data:{settings:{hero_title:'不能越权'}}})).status(),403);
  checks.push('管理员无法编辑站主设置');assert.deepEqual(errors,[]);for(const c of checks)console.log('PASS '+c);
 }finally{fs.writeFileSync(path.join(out,'owner-browser.json'),JSON.stringify({checks,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

