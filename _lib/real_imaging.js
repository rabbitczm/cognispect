var ImagingCompute=(()=>{
 'use strict';
 let worker,sequence=0;const jobs=new Map();
 function prepare(){
  if(!worker){worker=new Worker('/assets/imaging-worker.js?v=24');worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);};worker.onerror=error=>{for(const job of jobs.values())job.reject(Error(error.message));jobs.clear();worker.terminate();worker=null;};}
  return worker;
 }
 function run(type,payload={},transfer=[]){
  prepare();
  return new Promise((resolve,reject)=>{const id=++sequence;jobs.set(id,{resolve,reject});worker.postMessage({id,type,...payload},transfer);});
 }
 return {run,prepare};
})();
var RealImaging=(()=>{
 'use strict';
 const version='imaging-slices-v24.1',state={id:'brain',slice:16,window:100,level:40,zoom:1,tool:'polygon',brush:8,bin:25,points:[],masks:new Map(),pixels:null,status:'',manifest:typeof IMAGING_MANIFEST!=='undefined'?IMAGING_MANIFEST:null};
 const chunks=new Map(),chunkJobs=new Map();const memoryBudget=32*1024*1024;let memoryBytes=0,manifestJob,ticket=0,metricsTicket=0,drawFrame=0,sliceFrame=0,metricsTimer,prefetchTimer,prefetchAbort,baseCanvas,baseKey='',drawing=false,loadedKey='';
 const $=selector=>document.querySelector(selector),e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dataset=()=>state.manifest?.datasets.find(item=>item.id===state.id);
 const maskKey=()=>state.id+':'+state.slice;
 function mask(){const d=dataset();if(!state.masks.has(maskKey()))state.masks.set(maskKey(),new Uint8Array(d.width*d.height));return state.masks.get(maskKey());}
 async function resource(url,options={priority:'high'}){if(typeof PublicCache!=='undefined')return PublicCache.resource(url,version,options);const response=await fetch(url,options);if(!response.ok)throw Error('影像读取未完成，请重试');return response.blob();}
 async function manifest(){if(state.manifest)return state.manifest;if(!manifestJob)manifestJob=resource('/assets/imaging/v24/manifest.json').then(blob=>blob.text()).then(text=>state.manifest=JSON.parse(text)).catch(error=>{manifestJob=null;throw error;});return manifestJob;}
 function statistics(pixels,roi,width,height,spacing,binWidth=25){return ResearchCore.features(pixels,roi,width,height,{spacing:Math.sqrt(spacing[0]*spacing[1]),binWidth});}
 function coordinate(event,bounds,width,height){return [(event.clientX-bounds.left)*width/bounds.width,(event.clientY-bounds.top)*height/bounds.height];}
 function scalarArray(buffer,dtype){return dtype==='<i4'?new Int32Array(buffer):new Float32Array(buffer);}
 function render(){return `<div id="realImageHost" class="real-image-workspace">${state.manifest?content():'<section class="glass imaging-studio"><h2>高清公开影像</h2><p role="status">正在读取影像目录…</p></section>'}</div>`;}
 function content(){const d=dataset();return `<div class="imaging-layout"><section class="glass imaging-studio"><div class="sim-title"><div><div class="section-eyebrow">真实公开影像 / ${d.width} × ${d.height}</div><h2>${e(d.title)}</h2></div><span class="status-pill">CT · ${e(d.units)}</span></div><div class="real-image-slice-tools"><button class="btn ghost tiny" id="realSlicePrev" aria-label="上一张切片">上一张</button><label for="realSlice">切片 <output id="realSliceNumber">${state.slice+1} / ${d.slices}</output></label><input id="realSlice" type="range" min="0" max="${d.slices-1}" value="${state.slice}"><button class="btn ghost tiny" id="realSliceNext" aria-label="下一张切片">下一张</button></div><div class="real-image-viewport" id="realImageViewport"><canvas id="realImageCanvas" width="${d.width}" height="${d.height}" aria-label="${e(d.title)}原始分辨率切片与 ROI"></canvas></div><p class="real-image-status" id="realImageStatus" role="status">${e(state.status)}</p><div class="simulation-toolbar"><button class="btn" id="realClose">闭合 ROI 并计算</button><button class="btn ghost" id="realUndo">撤销顶点</button><button class="btn ghost" id="realClear">清空本层 ROI</button><button class="textlink" id="realExportPng">导出 PNG</button><button class="textlink" id="realExportJson">导出 ROI 数据</button></div><div id="realImageMetrics"></div><div id="realImageHistogram" class="image-histogram"></div></section><aside class="glass sim-controls"><h2>影像与显示</h2><div class="work-field"><label for="realDataset">公开影像序列</label><select id="realDataset">${state.manifest.datasets.map(item=>`<option value="${item.id}"${item.id===d.id?' selected':''}>${e(item.title)}</option>`).join('')}</select></div><div class="field-pair"><div class="work-field"><label for="realWindow">窗宽 HU</label><input id="realWindow" type="number" min="1" value="${state.window}"></div><div class="work-field"><label for="realLevel">窗位 HU</label><input id="realLevel" type="number" value="${state.level}"></div></div><div class="work-field"><label for="realZoom">显示缩放 <output id="realZoomValue">${state.zoom.toFixed(1)}×</output></label><input id="realZoom" type="range" min="1" max="4" step=".25" value="${state.zoom}"></div><div class="work-field"><label for="realTool">ROI 工具</label><select id="realTool"><option value="polygon"${state.tool==='polygon'?' selected':''}>多边形</option><option value="brush"${state.tool==='brush'?' selected':''}>画笔</option><option value="erase"${state.tool==='erase'?' selected':''}>橡皮</option></select></div><div class="field-pair"><div class="work-field"><label for="realBrush">笔刷半径 px</label><input id="realBrush" type="number" min="1" max="60" value="${state.brush}"></div><div class="work-field"><label for="realBin">熵分箱宽度 HU</label><input id="realBin" type="number" min="1" value="${state.bin}"></div></div><details class="real-image-provenance"><summary>序列与来源</summary><dl><dt>原始矩阵</dt><dd>${d.width} × ${d.height} × ${d.originalSlices}</dd><dt>本地序列</dt><dd>原始第 ${d.sourceSliceStart+1}–${d.sourceSliceStart+d.slices} 层</dd><dt>像素间距</dt><dd>${d.spacing[0].toFixed(5)} × ${d.spacing[1].toFixed(5)} mm</dd><dt>层间距</dt><dd>${d.spacing[2].toFixed(5)} mm</dd></dl><p>${e(d.source)}</p><p>${e(d.processing)}</p><a href="${e(d.sourceUrl)}" target="_blank" rel="noopener">原始数据 ↗</a><br><a href="${e(d.licenseUrl)}" target="_blank" rel="noopener">${e(d.license)} ↗</a></details></aside></div>`;}
 function cachedChunk(url){const values=chunks.get(url);if(values){chunks.delete(url);chunks.set(url,values);}return values;}
 async function loadChunk(d,entry,priority='high'){
  const cached=cachedChunk(entry.url);if(cached)return cached;
  if(!chunkJobs.has(entry.url))chunkJobs.set(entry.url,(async()=>{
   const blob=await resource(entry.url,{priority}),buffer=await blob.arrayBuffer(),values=await ImagingCompute.run('decode',{buffer,dtype:d.dtype},[buffer]);
   chunks.set(entry.url,values);memoryBytes+=values.byteLength;
   while(memoryBytes>memoryBudget&&chunks.size>1){const key=chunks.keys().next().value;memoryBytes-=chunks.get(key).byteLength;chunks.delete(key);}return values;
  })().finally(()=>chunkJobs.delete(entry.url)));
  return chunkJobs.get(entry.url);
 }
 function prefetch(d,entry){clearTimeout(prefetchTimer);prefetchAbort?.abort();const generation=ticket,controller=new AbortController();prefetchAbort=controller;prefetchTimer=setTimeout(()=>{
  const work=async scheduled=>{const signal=scheduled?AbortSignal.any([controller.signal,scheduled]):controller.signal;
   try{const index=d.chunks.indexOf(entry);for(const adjacent of [d.chunks[index+1],d.chunks[index-1]]){if(document.hidden||generation!==ticket||!$('#realImageCanvas')||state.id!==d.id||controller.signal.aborted)return;if(scheduled?.aborted)throw new DOMException('Aborted','AbortError');if(adjacent)await resource(adjacent.url,{priority:'low',signal});}}
   catch(error){if(!controller.signal.aborted)throw error;}
  };
  if(typeof BackgroundTasks!=='undefined')BackgroundTasks.run(work).catch(()=>{});else work().catch(()=>{});
 },200);}
 async function readSlice(){prefetchAbort?.abort();clearTimeout(prefetchTimer);ImagingCompute.prepare();const current=++ticket,d=dataset(),index=state.slice,entry=d.chunks.find(item=>index>=item.start&&index<item.start+item.count);drawing=false;loadedKey='';state.status='正在读取第 '+(index+1)+' 层…';if($('#realImageStatus'))$('#realImageStatus').textContent=state.status;
  try{const values=await loadChunk(d,entry);if(current!==ticket||!$('#realImageCanvas'))return;
   const start=(index-entry.start)*d.width*d.height;state.pixels=values.subarray(start,start+d.width*d.height);loadedKey=maskKey();state.status='原始第 '+(d.sourceSliceStart+index+1)+' 层 · '+d.width+' × '+d.height+' · 本层 ROI 独立保存';state.points=[];baseKey='';draw();metrics();prefetch(d,entry);
  }catch(error){if(current===ticket&&$('#realImageStatus'))$('#realImageStatus').textContent=error.message;}
 }
 function requestDraw(){if(!drawFrame)drawFrame=requestAnimationFrame(()=>{drawFrame=0;draw();});}
 function scheduleMetrics(){clearTimeout(metricsTimer);metricsTimer=setTimeout(metrics,160);}
 function zoom(){const d=dataset(),canvas=$('#realImageCanvas'),viewport=$('#realImageViewport');if(!canvas||!viewport)return;canvas.style.width=Math.max(1,Math.min(d.width,viewport.clientWidth-24)*state.zoom)+'px';canvas.style.height='auto';$('#realZoomValue').textContent=state.zoom.toFixed(2)+'×';}
 function draw(){const d=dataset(),canvas=$('#realImageCanvas');if(!canvas||!state.pixels||loadedKey!==maskKey())return;const context=canvas.getContext('2d'),key=loadedKey+':'+state.window+':'+state.level;
  if(baseKey!==key){baseCanvas=document.createElement('canvas');baseCanvas.width=d.width;baseCanvas.height=d.height;const gray=baseCanvas.getContext('2d').createImageData(d.width,d.height);
   for(let i=0;i<state.pixels.length;i++){const value=Math.max(0,Math.min(255,255*((state.pixels[i]-state.level)/state.window+.5))),offset=i*4;gray.data[offset]=gray.data[offset+1]=gray.data[offset+2]=value;gray.data[offset+3]=255;}
   baseCanvas.getContext('2d').putImageData(gray,0,0);baseKey=key;
  }
  context.drawImage(baseCanvas,0,0);const roi=mask();context.fillStyle='rgba(40,150,112,.36)';
  for(let y=0;y<d.height;y++){let start=-1;for(let x=0;x<=d.width;x++){const active=x<d.width&&roi[y*d.width+x];if(active&&start<0)start=x;else if(!active&&start>=0){context.fillRect(start,y,x-start,1);start=-1;}}}
  if(state.points.length){context.strokeStyle='#e8c995';context.lineWidth=1.5;context.beginPath();state.points.forEach(([x,y],i)=>i?context.lineTo(x,y):context.moveTo(x,y));context.stroke();for(const [x,y]of state.points)context.fillRect(x-2,y-2,4,4);}
  $('#realImageStatus').textContent=state.status;zoom();
 }
 async function metrics(){clearTimeout(metricsTimer);const current=++metricsTicket,d=dataset(),key=loadedKey,box=$('#realImageMetrics'),hist=$('#realImageHistogram');if(!box||!state.pixels||key!==maskKey())return;
  try{const result=await ImagingCompute.run('statistics',{pixels:state.pixels,mask:mask(),width:d.width,height:d.height,spacing:Math.sqrt(d.spacing[0]*d.spacing[1]),binWidth:state.bin});if(current!==metricsTicket||key!==loadedKey||!box.isConnected)return;const f=result.features;
   box.innerHTML='<div class="lab-readout">'+[['面积 mm²',f.areaMm2.toFixed(2)],['平均 HU',f.mean.toFixed(2)],['总体 SD',f.sd.toFixed(2)],['熵 bit',f.entropy.toFixed(3)],['像素数',f.count]].map(([title,value])=>`<div class="metric"><span>${title}</span><b>${value}</b></div>`).join('')+'</div>';const max=Math.max(...f.histogram.map(item=>item.count));hist.innerHTML='<p class="hint">ROI 灰度直方图 · HU</p><svg viewBox="0 0 700 100" role="img" aria-label="真实影像 ROI 灰度直方图">'+f.histogram.map((item,i)=>`<rect x="${i/f.histogram.length*700}" y="${95-item.count/max*85}" width="${Math.max(.3,700/f.histogram.length-1)}" height="${item.count/max*85}" fill="currentColor"><title>${item.lower}: ${item.count}</title></rect>`).join('')+'</svg>';
  }catch{if(current!==metricsTicket||key!==loadedKey||!box.isConnected)return;box.innerHTML='<p class="hint">在本层影像上绘制 ROI，查看面积、灰度和直方图。</p>';hist.innerHTML='';}
 }
 function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function controls(){const d=dataset();$('#realDataset').onchange=event=>{state.id=event.target.value;const fresh=dataset();state.slice=Math.floor(fresh.slices/2);state.window=fresh.window;state.level=fresh.level;dispose();state.pixels=null;state.points=[];state.zoom=1;$('#realImageHost').innerHTML=content();controls();readSlice();};
  const changeSlice=value=>{state.slice=Math.max(0,Math.min(d.slices-1,Number(value)));ticket++;metricsTicket++;loadedKey='';drawing=false;state.points=[];$('#realSlice').value=state.slice;$('#realSliceNumber').textContent=(state.slice+1)+' / '+d.slices;$('#realImageStatus').textContent='正在读取第 '+(state.slice+1)+' 层…';if(!sliceFrame)sliceFrame=requestAnimationFrame(()=>{sliceFrame=0;readSlice();});};$('#realSlice').oninput=event=>changeSlice(event.target.value);$('#realSlicePrev').onclick=()=>changeSlice(state.slice-1);$('#realSliceNext').onclick=()=>changeSlice(state.slice+1);
  $('#realWindow').onchange=event=>{state.window=Math.max(1,Number(event.target.value)||1);draw();};$('#realLevel').onchange=event=>{state.level=Number(event.target.value)||0;draw();};$('#realZoom').oninput=event=>{state.zoom=Number(event.target.value);zoom();};$('#realTool').onchange=event=>state.tool=event.target.value;$('#realBrush').onchange=event=>state.brush=Math.max(1,Math.min(60,Number(event.target.value)||8));$('#realBin').onchange=event=>{state.bin=Math.max(1,Number(event.target.value)||25);metrics();};
  $('#realClear').onclick=()=>{state.masks.delete(maskKey());state.points=[];draw();metrics();};$('#realUndo').onclick=()=>{state.points.pop();draw();};$('#realClose').onclick=async()=>{const key=loadedKey,current=++metricsTicket;if(key!==maskKey())return;try{const roi=await ImagingCompute.run('polygon',{width:d.width,height:d.height,points:state.points});if(key!==loadedKey||current!==metricsTicket)return;state.masks.set(key,roi);state.points=[];draw();metrics();}catch(error){if(key===loadedKey)$('#realImageStatus').textContent=error.message;}};
  const canvas=$('#realImageCanvas');const point=event=>coordinate(event,canvas.getBoundingClientRect(),d.width,d.height);const brush=event=>{if(!state.pixels||loadedKey!==maskKey())return;const [x,y]=point(event),roi=mask(),r=state.brush;for(let j=Math.max(0,Math.floor(y-r));j<Math.min(d.height,y+r);j++)for(let i=Math.max(0,Math.floor(x-r));i<Math.min(d.width,x+r);i++)if((i-x)**2+(j-y)**2<r*r)roi[j*d.width+i]=state.tool==='erase'?0:1;metricsTicket++;requestDraw();scheduleMetrics();};
  canvas.onpointerdown=event=>{if(!state.pixels||loadedKey!==maskKey())return;if(state.tool==='polygon'){state.points.push(point(event));requestDraw();}else{drawing=true;canvas.setPointerCapture(event.pointerId);brush(event);}};canvas.onpointermove=event=>{if(drawing)brush(event);};canvas.onpointerup=canvas.onpointercancel=()=>{if(drawing){drawing=false;metrics();}};
  $('#realExportPng').onclick=()=>canvas.toBlob(blob=>saveBlob(blob,'知镜-'+d.id+'-第'+(d.sourceSliceStart+state.slice+1)+'层.png'));
  $('#realExportJson').onclick=()=>{if(loadedKey!==maskKey())return;const data={dataset:d.id,source:d.source,license:d.license,sourceUrl:d.sourceUrl,width:d.width,height:d.height,sourceSlice:d.sourceSliceStart+state.slice,spacing:d.spacing,directions:d.directions,origin:d.origin,space:d.space,units:d.units,window:state.window,level:state.level,roi:Array.from(mask()),pixels:Array.from(state.pixels||[])};saveBlob(new Blob([JSON.stringify(data)],{type:'application/json'}),'知镜-'+d.id+'-ROI.json');};
 }
 function dispose(){ticket++;metricsTicket++;loadedKey='';drawing=false;clearTimeout(metricsTimer);clearTimeout(prefetchTimer);prefetchAbort?.abort();cancelAnimationFrame(drawFrame);cancelAnimationFrame(sliceFrame);drawFrame=sliceFrame=0;}
 async function bind(){try{ImagingCompute.prepare();await manifest();if(!$('#realImageHost'))return;$('#realImageHost').innerHTML=content();controls();readSlice();}catch(error){if($('#realImageHost'))$('#realImageHost').innerHTML='<p role="status">'+e(error.message)+'</p><button class="btn" id="realRetry">重试</button>';$('#realRetry')?.addEventListener('click',bind);}}
 if(typeof window!=='undefined')window.addEventListener('resize',()=>{if($('#realImageCanvas'))zoom();});
 return {render,bind,dispose,state,statistics,coordinate,scalarArray};
})();
if(typeof module!=='undefined')module.exports=RealImaging;
