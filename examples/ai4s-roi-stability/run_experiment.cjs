const fs = require('node:fs');
const path = require('node:path');
const Simulation = require('./source/simulation_core.cjs');
const Research = require('./source/research-core.cjs');
const root = __dirname;
const config = {
  question: '影像噪声及ROI轮廓变化对定量测量稳定性的影响',
  presets: ['brain','liver','vessel'], noise: [0,5,15,30,60],
  seeds: Array.from({length:20},(_,i)=>i+1),
  parameters: {radius:12,contrast:180,spacing:0.35},
  width:512,height:512,binWidth:25,
  masks:['eroded','truth','dilated'],
  morphology:'one iteration, four-neighbour cross (centre/up/down/left/right), background outside image',
  pairing:'same preset and seed use the same pseudorandom noise field at every noise level',
  units:{areaMm2:'mm²',mean:'合成灰度',sd:'合成灰度',entropy:'bit',dice:'无量纲'},
  generator:'source/simulation_core.cjs',statistics:'source/research-core.cjs'
};
function perturb(a,w,h,kind){
  const b = new Uint8Array(a.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x, values=[a[i],x? a[i-1]:0,x+1<w?a[i+1]:0,y?a[i-w]:0,y+1<h?a[i+w]:0];
    b[i]=kind==='eroded'?Number(values.every(Boolean)):Number(values.some(Boolean));
  }
  return b;
}
const start=performance.now(),rows=[];
for(const preset of config.presets){
  for(const noise of config.noise)for(const seed of config.seeds){
    const img=Simulation.image({...config.parameters,preset,noise,seed});
    const masks={eroded:perturb(img.truth,img.width,img.height,'eroded'),truth:img.truth,dilated:perturb(img.truth,img.width,img.height,'dilated')};
    for(const [maskName,mask]of Object.entries(masks)){
      const f=Research.features(img.pixels,mask,img.width,img.height,{spacing:img.spacing,binWidth:config.binWidth});
      rows.push({preset,noise,seed,mask:maskName,count:f.count,areaMm2:f.areaMm2,mean:f.mean,sd:f.sd,entropy:f.entropy,dice:Research.dice(mask,img.truth)});
    }
    if(seed===1&&[0,15,60].includes(noise)){
      const base=path.join(root,'samples',`${preset}-noise${noise}`);
      fs.writeFileSync(base+'.f64',Buffer.from(img.pixels.buffer));
      if(noise===0)for(const [name,mask]of Object.entries(masks))fs.writeFileSync(path.join(root,'samples',`${preset}-${name}.u8`),Buffer.from(mask));
    }
  }
}
const columns=Object.keys(rows[0]);
fs.writeFileSync(path.join(root,'raw_results.csv'),'\ufeff'+columns.join(',')+'\n'+rows.map(row=>columns.map(k=>row[k]).join(',')).join('\n')+'\n');
fs.writeFileSync(path.join(root,'raw_results.json'),JSON.stringify(rows,null,2));
fs.writeFileSync(path.join(root,'parameters.json'),JSON.stringify(config,null,2));
fs.writeFileSync(path.join(root,'run_metadata.json'),JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,elapsedMs:performance.now()-start,images:config.presets.length*config.noise.length*config.seeds.length,measurements:rows.length,createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({images:300,measurements:rows.length,elapsedMs:performance.now()-start}));
