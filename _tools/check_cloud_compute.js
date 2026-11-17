const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require(process.env.HELIX_PLAYWRIGHT_MODULE || 'D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const root = path.resolve(__dirname, '..');
const out = process.env.HELIX_COMPUTE_OUTPUT || 'D:/workspace/codex_list/output/zhijing-cloud/verification/compute';
const url = process.env.HELIX_COMPUTE_URL || 'http://127.0.0.1:8101';
function compare(actual, expected, position = '') {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', position);
    assert.ok(Math.abs(actual-expected) <= Math.max(1e-7, Math.abs(expected)*1e-5), `${position}: ${actual} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, position);
    expected.forEach((value, i) => compare(actual[i], value, position+'['+i+']'));
  } else if (expected && typeof expected === 'object') {
    for (const [key, value] of Object.entries(expected)) compare(actual[key], value, position+'.'+key);
  } else assert.equal(actual, expected, position);
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir='+path.join(out,'cache')]});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),checks=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')console.error('BROWSER '+message.text());});
  try {
    await page.goto(url+'/assets/compute/runtime.json');
    await page.addScriptTag({path:path.join(root,'_lib/browser_compute.js')});
    await page.addStyleTag({path:path.join(root,'_lib/browser_compute.css')});
    await page.evaluate(()=>{window.ZHIJING_RUNTIME='cloud';});
    const cancelled = await page.evaluate(async()=>{const job=BrowserCompute.request('stats',{mode:'paired',csv:'subject,before,after\na,1,2\nb,2,4'});BrowserCompute.cancel();try{await job;return false;}catch(e){return e.name==='AbortError';}});
    assert.ok(cancelled);checks.push('cancel-load');
    const baseline = JSON.parse(fs.readFileSync(path.join(out,'baseline.json'),'utf8'));
    for (const fixture of baseline) {
      const payload=fixture.operation==='pdf'?{...fixture.data,bytes:[...fs.readFileSync(path.join(out,'table.pdf'))]}:fixture.data;
      const result=await page.evaluate(async({operation,payload})=>{if(operation==='pdf')payload.bytes=new Uint8Array(payload.bytes).buffer;return BrowserCompute.request(operation,payload);},{operation:fixture.operation,payload});
      const expected={...fixture.expected};
      if(fixture.name==='fit'){
        // Summaries format machine-precision residuals as text. Compare the
        // underlying numerical metrics below with the same result tolerance.
        assert.match(result.summary,/二室静脉推注模型，12个观测/);
        delete expected.summary;
      }
      compare(result, expected, fixture.name);
      if(fixture.operation!=='pdf'){
        assert.ok(result.python_export?.includes('import numpy') || result.python_export?.includes('def analyze_csv'));
        if(fixture.operation!=='fit')assert.ok(result.python_export.includes(fixture.data.csv.split('\n')[0]));
      }
      fs.writeFileSync(path.join(out,fixture.name+'-browser.json'),JSON.stringify(result,null,2));
      checks.push(fixture.name);console.log('PASS '+fixture.name+' browser/Python parity');
    }
    assert.ok(await page.locator('#browserComputeStatus').isHidden());
    assert.deepEqual(errors,[]);
  } finally {
    fs.writeFileSync(path.join(out,'browser-parity.json'),JSON.stringify({checks,errors},null,2));
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
