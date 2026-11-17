/* Deterministic educational phantom and transparent 2D ROI formulas. Not a clinical model. */
var ResearchCore=(()=>{
'use strict';
function positive(v,name){v=Number(v);if(!Number.isFinite(v)||v<=0)throw new Error(name+'必须是正数');return v;}
function polygonMask(w,h,points){
 if(points.length<3)throw new Error('至少需要三个轮廓点');
 const out=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const px=x+.5,py=y+.5;let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
   const [xi,yi]=points[i],[xj,yj]=points[j];
   if((yi>py)!==(yj>py)&&px<(xj-xi)*(py-yi)/(yj-yi)+xi)inside=!inside;
  }
  out[y*w+x]=inside?1:0;
 }
 return out;
}
function features(pixels,mask,width,height,{spacing=1,binWidth=25}={}){
 spacing=positive(spacing,'像素间距');binWidth=positive(binWidth,'离散宽度');
 if(pixels.length!==mask.length||pixels.length!==width*height)throw new Error('图像与掩膜尺寸不一致');
 const a=[];let minimum=Infinity,maximum=-Infinity;for(let i=0;i<pixels.length;i++)if(mask[i]){if(!Number.isFinite(pixels[i]))throw new Error('ROI含非有限像素');a.push(pixels[i]);minimum=Math.min(minimum,pixels[i]);maximum=Math.max(maximum,pixels[i]);}
 if(!a.length)throw new Error('ROI为空，无法计算');
 const n=a.length,mean=a.reduce((s,x)=>s+x,0)/n,variance=a.reduce((s,x)=>s+(x-mean)**2,0)/n;
 const bins=new Map();a.forEach(v=>{const b=Math.floor(v/binWidth);bins.set(b,(bins.get(b)||0)+1);});
 const entropy=[...bins.values()].reduce((s,c)=>s-(c/n)*Math.log2(c/n),0),areaMm2=n*spacing**2;
 return {count:n,areaMm2,equivalentDiameterMm:2*Math.sqrt(areaMm2/Math.PI),mean,sd:Math.sqrt(variance),min:minimum,max:maximum,entropy,binWidth,
  histogram:[...bins].sort((a,b)=>a[0]-b[0]).map(([k,count])=>({lower:k*binWidth,count})),scope:'2D ROI; population SD; fixed bins anchored at 0; not IBSI certification'};
}
function dice(a,b){if(a.length!==b.length)throw new Error('掩膜尺寸不同');let x=0,y=0,overlap=0;for(let i=0;i<a.length;i++){x+=a[i]?1:0;y+=b[i]?1:0;overlap+=(a[i]&&b[i])?1:0;}return x+y?2*overlap/(x+y):null;}
function review(v){
 const missing=[],warnings=[],actions=[];
 const labels={question:'研究问题',label:'标签来源',grouped:'病人分组',preprocess:'训练折内预处理',external:'外部验证',uncertainty:'不确定性',limitations:'局限与失败例'};
 Object.entries(labels).forEach(([k,label])=>{if(!v[k]||v[k]==='unknown')missing.push(label);});
 if(v.label==='reader'){warnings.push('医师评分是代理标签，不能等同于病理确诊。');actions.push('在目的、方法和结论中保持医师评分预测的口径。');}
 if(v.grouped==='no'){warnings.push('同一病人的样本可能跨训练和测试集合，存在泄漏风险。');actions.push('按病人重新划分并重做所有预处理与评估。');}
 if(v.preprocess==='no'){warnings.push('使用全数据拟合预处理会使验证偏乐观。');actions.push('把填补、选择、缩放等放入训练折内。');}
 if(v.external==='no'){warnings.push('目前没有独立外部验证，不能声称外部泛化已验证。');actions.push('将结果定位为内部验证，并规划独立样本评估。');}
 if(v.uncertainty==='no')actions.push('报告置信区间，重复病人数据需按病人单位估计。');
 return {missing,warnings,actions,scope:'规则辅助复盘，不是正式TRIPOD/CLEAR评分或同行评审'};
}
return {polygonMask,features,dice,review};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ResearchCore;
