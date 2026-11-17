const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('D:/workspace/codex_list/tools/helix-browser/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),output='D:/workspace/codex_list/output/zhijing-v22/verification';
(async()=>{
 await fs.mkdir(output,{recursive:true});const catalog=JSON.parse(await fs.readFile(path.join(root,'data/anatomy-catalog.json'),'utf8'));
 const server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>body{margin:0;background:#edf2f0}#stage{width:700px;height:800px}</style><div id="stage"></div><script src="/_lib/vendor/three-0.160.1.min.js"></script><script>var ANATOMY=${JSON.stringify(catalog)}</script><script src="/_lib/anatomy_open_model.js"></script><script>window.viewer=AnatomyModel.mount(document.querySelector('#stage'));viewer.loadLite().then(ids=>{viewer.setVisible(ids);viewer.fit(ids);window.ready=true;});</script>`);return;}const file=path.join(root,new URL(req.url,'http://local').pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end('Missing');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disk-cache-dir=D:/workspace/codex_list/scratch/v22-anatomy-chrome']});
  const page=await browser.newPage({viewport:{width:740,height:850}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('.bin.gz'))requests.push(r.url().split('/').pop());});
  const start=Date.now();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready,{timeout:30000});
  const liteMs=Date.now()-start;assert.deepEqual(requests,['lite.bin.gz']);assert.equal(await page.evaluate(()=>viewer.refinedCount),0);await page.screenshot({path:output+'/anatomy-lite.png'});
  assert.ok((await page.evaluate(()=>viewer.visibleIds().length))>100);await page.mouse.move(340,370);await page.mouse.down();await page.mouse.move(430,390,{steps:8});await page.mouse.up();
  await page.evaluate(async()=>{await viewer.ensure(ANATOMY.parts.FMA7088.elements);viewer.setVisible(ANATOMY.parts.FMA7088.elements);viewer.highlight(ANATOMY.parts.FMA7088.elements);viewer.fit(ANATOMY.parts.FMA7088.elements);});
  assert.ok(await page.evaluate(()=>viewer.refinedCount>0));assert.ok(requests.length<10);assert.ok(!requests.some(x=>/^skeleton/.test(x)));
  const count=requests.length;await page.evaluate(async()=>{await viewer.ensure(ANATOMY.parts.FMA7088.elements);});assert.equal(requests.length,count);
  await page.screenshot({path:output+'/anatomy-progressive.png'});assert.deepEqual(errors,[]);
  const result={liteMs,requests,errors,checks:['initial-lite-only','interactive-rotation','organ-only-refinement','repeated-organ-no-download']};await fs.writeFile(output+'/anatomy.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
