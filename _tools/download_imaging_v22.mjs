import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Agent,fetch}=require('D:/workspace/codex_list/tools/helix-wrangler/node_modules/undici');
const agent=new Agent({connect:{maxVersion:'TLSv1.2'},headersTimeout:120000});
const dir='D:/workspace/codex_list/code/zhijing/data/imaging-sources';
await fs.mkdir(dir,{recursive:true});
const root='https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/';
const cases=[['brain.nrrd',root+'6a5b6caccb76576a863beb095e3bfb910c50ca78f4c9bf043aa42f976cfa53d1'],['liver.nrrd',root+'e16eae0ae6fefa858c5c11e58f0f1bb81834d81b7102e021571056324ef6f37e'],['vessel.nii.gz','https://msd-for-monai.s3-us-west-2.amazonaws.com/Task08_HepaticVessel.tar',{Range:'bytes=43520-8095965'}],['vessel-dataset.json','https://msd-for-monai.s3-us-west-2.amazonaws.com/Task08_HepaticVessel.tar',{Range:'bytes=7680-41845'}],['slicer-source.py','https://raw.githubusercontent.com/Slicer/Slicer/main/Modules/Scripted/SampleData/SampleData.py']];
try{await Promise.all(cases.map(async([name,url,headers])=>{try{if((await fs.stat(dir+'/'+name)).size>0)return;}catch{}const r=await fetch(url,{dispatcher:agent,headers,signal:AbortSignal.timeout(240000)});if(!r.ok)throw Error(name+' HTTP '+r.status);const bytes=Buffer.from(await r.arrayBuffer());await fs.writeFile(dir+'/'+name,bytes);console.log(name+' '+bytes.length);}));}finally{await agent.close();}
