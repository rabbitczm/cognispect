const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=__dirname;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.cjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1'),relative=decodeURIComponent(url.pathname),file=path.join(root,relative.endsWith('/')?relative+'index.html':relative);
 if(path.relative(root,file).startsWith('..')){response.statusCode=404;response.end('文件未找到');return;}
 response.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');
 const stream=fs.createReadStream(file);stream.on('error',()=>{response.statusCode=404;response.end('文件未找到');});stream.pipe(response);
});
server.listen(Number(process.env.ZHIJING_DEMO_PORT??8778),'127.0.0.1',()=>{
 const address='http://127.0.0.1:'+server.address().port+'/demo/';
 console.log('知镜离线演示版：'+address+'\n关闭本窗口停止服务。');
 if(process.env.ZHIJING_DEMO_NO_OPEN!=='1')spawn('explorer.exe',[address],{windowsHide:true,detached:true,stdio:'ignore'}).unref();
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'8778 端口正在使用，请关闭此前的演示启动窗口后重试。':error.message);process.exitCode=1;});
