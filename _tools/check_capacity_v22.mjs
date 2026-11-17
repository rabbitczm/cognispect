import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const base=process.env.HELIX_V22_URL||'https://v22-preview.cognispect.pages.dev';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',...(process.env.HELIX_BROWSER_PROXY?{proxy:{server:process.env.HELIX_BROWSER_PROXY}}:{}),args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v22-capacity-browser']});
try{
 const page=await browser.newPage();await page.goto(base+'/robots.txt',{timeout:60000});
 const runs=await page.evaluate(async()=>{
  const runs=[];
  for(const concurrency of [1,5,10]){
   const timings=[],errors=[],count=20;let cursor=0;const started=performance.now();
   await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<count){cursor++;const begin=performance.now();try{const response=await fetch('/api/library?limit=20',{signal:AbortSignal.timeout(45000)}),data=await response.json();if(response.status!==200||data.docs?.length!==20)errors.push({status:response.status,error:data.error});}catch(e){errors.push(e.message);}timings.push(performance.now()-begin);}}));
   timings.sort((a,b)=>a-b);const elapsed=performance.now()-started;runs.push({concurrency,requests:count,errors,elapsedMs:Math.round(elapsed),requestsPerSecond:Number((count/(elapsed/1000)).toFixed(2)),medianMs:Math.round(timings[Math.floor(timings.length*.5)]),p95Ms:Math.round(timings[Math.min(timings.length-1,Math.floor(timings.length*.95))])});
  }
  return runs;
 });
 const result={base,client:'Chrome',proxyConfigured:!!process.env.HELIX_BROWSER_PROXY,measuredAt:new Date().toISOString(),totalRequests:60,runs,interpretation:'有限真实接口并发测试，非最大容量测定；同一客户端、网络代理和连接复用影响结果。'};await fs.writeFile('D:/workspace/codex_list/output/zhijing-v22/verification/capacity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(runs.some(run=>run.errors.length))process.exitCode=1;
}finally{await browser.close();}
