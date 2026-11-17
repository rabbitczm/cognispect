const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),C=require('../_lib/simulation_core.js'),R=require('../_lib/research_core.js');
const messages=[],context=vm.createContext({Blob,Response,DecompressionStream,Float32Array,Float64Array,Int32Array,Uint8Array,Map,Math,Number,Set,Error,Array,Object,console});
context.self={postMessage:message=>messages.push(message)};
context.importScripts=(...urls)=>urls.forEach(url=>vm.runInContext(fs.readFileSync(path.join(root,'_lib',url.includes('research')?'research_core.js':'simulation_core.js'),'utf8'),context));
vm.runInContext(fs.readFileSync(path.join(root,'assets/imaging-worker.js'),'utf8'),context);
async function run(type,payload){await context.self.onmessage({data:{id:messages.length+1,type,...payload}});const message=messages.at(-1);if(message.error)throw Error(message.error);return message.result;}
(async()=>{
 for(const [dtype,Type]of [['<i4',Int32Array],['<f4',Float32Array]]){
  const values=new Type([0,100,200,300,400,500]),compressed=zlib.gzipSync(values);
  const decoded=await run('decode',{buffer:compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.byteLength),dtype});
  assert.deepEqual([...decoded],[...values]);
 }
 for(const preset of ['brain','liver','vessel']){
  const actual=await run('synthetic',{parameters:{preset}}),expected=C.image({preset});
  assert.deepEqual([...actual.pixels],[...expected.pixels]);assert.deepEqual([...actual.truth],[...expected.truth]);
  const summary=await run('statistics',{pixels:actual.pixels,mask:actual.truth,width:actual.width,height:actual.height,spacing:actual.spacing,binWidth:25,truth:actual.truth});
  assert.equal(summary.dice,1);assert.equal(summary.features.mean,R.features(expected.pixels,expected.truth,512,512,{spacing:expected.spacing}).mean);
 }
 console.log('PASS worker decodes original values and preserves three synthetic images, ROI statistics and Dice');
})().catch(error=>{console.error(error);process.exitCode=1;});
