/* Normal guest workflows: compute, export, PDF reading, and table-to-analysis. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HELIX_PLAYWRIGHT_MODULE||'D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const out=process.env.HELIX_COMPUTE_OUTPUT||'D:/workspace/codex_list/output/zhijing-cloud/verification/compute';
const url=process.env.HELIX_COMPUTE_UI_URL||'http://127.0.0.1:8097';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir='+path.join(out,'ui-cache')]}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],checks=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.ZHIJING_RUNTIME='cloud';});
 async function download(id,name){const event=page.waitForEvent('download');await page.locator(id).click();await(await event).saveAs(path.join(out,name));return fs.readFileSync(path.join(out,name));}
 try{
  await page.goto(url+'/?intro=done#medical');await page.waitForFunction(()=>typeof PersonalStore!=='undefined'&&PersonalStore.ready);
  await page.evaluate(()=>goto('medical'));await page.locator('#medicalMode').selectOption('paired');await page.locator('#medicalSample').click();await page.locator('#medicalRun').click();await page.getByText('分析完成',{exact:true}).waitFor({timeout:90000});
  assert.equal(await page.evaluate(()=>PersonalStore.user),null);
  assert.match(await page.locator('#medicalResult').innerText(),/完整配对数/);
  const svg=await download('#medicalExportSvg','guest-medical.svg');assert.match(svg.toString(),/<svg/);
  const png=await download('#medicalExportPng','guest-medical.png');assert.equal(png.readUInt32BE(0),0x89504e47);
  const py=await download('#medicalExportPython','guest-medical.py');assert.match(py.toString(),/def _paired/);
  await page.evaluate(()=>document.querySelector('main').scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(out,'guest-medical-mobile.png'),fullPage:true});checks.push('guest-medical-and-exports');
  await page.evaluate(()=>goto('pdf'));await page.locator('#pdfFile').setInputFiles(path.join(out,'table.pdf'));await page.locator('#pdfTableToStats').waitFor({timeout:90000});
  await page.waitForFunction(()=>document.querySelector('#pdfPreview canvas')?.width>0);
  assert.equal(await page.evaluate(()=>PdfUI.current.table_count),1);
  assert.match(await page.locator('#pdfPageText').innerText(),/Before/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const id=await page.evaluate(()=>PdfUI.current.id);
  await page.screenshot({path:path.join(out,'guest-pdf-mobile.png'),fullPage:true});
  await page.locator('#pdfTableToStats').click();await page.locator('#statsRun').click();await page.locator('#analysisChart svg').waitFor({timeout:90000});
  assert.match(await page.locator('#statsCsv').inputValue(),/P01/);checks.push('pdf-table-to-summary-plot');
  await page.reload();await page.waitForFunction(()=>typeof PersonalStore!=='undefined'&&PersonalStore.ready);await page.evaluate(()=>goto('pdf'));
  await page.locator('[data-pdf-id="'+id+'"]').waitFor();await page.locator('[data-pdf-id="'+id+'"]').click();await page.locator('#pdfTableToStats').waitFor();checks.push('guest-pdf-retained-after-reload');
  assert.deepEqual(errors,[]);
  console.log('PASS '+checks.join(', '));
 }finally{fs.writeFileSync(path.join(out,'guest-ui.json'),JSON.stringify({url,checks,errors},null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
