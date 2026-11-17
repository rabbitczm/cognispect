function research(){if(typeof ResearchCore==='undefined')importScripts('/assets/imaging/research-core.js');}
function simulation(){if(typeof SimulationCore==='undefined')importScripts('/assets/imaging/simulation-core.js');}
self.onmessage=async({data})=>{
 const {id,type}=data;
 try{
  let result,transfer=[];
  if(type==='decode'){
   const buffer=await new Response(new Blob([data.buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   result=data.dtype==='<i4'?new Int32Array(buffer):new Float32Array(buffer);transfer=[buffer];
  }else if(type==='synthetic'){
   simulation();result=SimulationCore.image(data.parameters);transfer=[result.pixels.buffer,result.truth.buffer];
  }else if(type==='statistics'){
   research();result={features:ResearchCore.features(data.pixels,data.mask,data.width,data.height,{spacing:data.spacing,binWidth:data.binWidth}),dice:data.truth?ResearchCore.dice(data.mask,data.truth):null};
  }else if(type==='polygon'){
   research();result=ResearchCore.polygonMask(data.width,data.height,data.points);transfer=[result.buffer];
  }
  self.postMessage({id,result},transfer);
 }catch(error){self.postMessage({id,error:error.message});}
};
