const assert=require('node:assert/strict'),C=require('../_lib/simulation_core.js'),R=require('../_lib/research_core.js');
for(const preset of ['brain','liver','vessel']){
 const image=C.image({preset});assert.equal(image.width,512);assert.equal(image.height,512);assert.equal(image.pixels.length,512*512);
 const expected=Math.PI*12*12*.8,features=R.features(image.pixels,image.truth,image.width,image.height,{spacing:image.spacing});
 assert.ok(Math.abs(features.areaMm2-expected)<expected*.04);assert.equal(R.dice(image.truth,image.truth),1);
}
console.log('PASS 512px synthetic anatomy and physical ROI area');
global.ResearchCore=R;
const Real=require('../_lib/real_imaging.js');
const summary=Real.statistics(new Float32Array([0,100,200,300,400,500]),new Uint8Array([0,1,1,0,0,1]),3,2,[.5,.8,2]);
assert.ok(Math.abs(summary.areaMm2-1.2)<1e-10);assert.equal(summary.mean,800/3);
assert.deepEqual(Real.coordinate({clientX:160,clientY:100},{left:10,top:20,width:300,height:200},512,507),[256,202.8]);
console.log('PASS rectangular original image ROI spacing and scaled pointer coordinates');
const full=R.features(new Float32Array(512*512),new Uint8Array(512*512).fill(1),512,512,{spacing:.5});assert.equal(full.areaMm2,65536);assert.equal(full.min,0);assert.equal(full.max,0);
console.log('PASS full-resolution whole-image threshold ROI');
