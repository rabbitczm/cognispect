import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {MeshoptEncoder as E,MeshoptSimplifier as S} from '../../../tools/anatomy-build/node_modules/meshoptimizer/index.js';
await Promise.all([E.ready,S.ready]);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'assets/anatomy/start-v24');fs.mkdirSync(out,{recursive:true});
const knowledge=JSON.parse(fs.readFileSync(path.join(root,'data/anatomy-knowledge.json'),'utf8'));
const presets=['FMA7088','FMA7158','FMA50801','FMA7197','FMA7205','FMA50720','FMA50723','FEMALE_uterus','FEMALE_ovaries','FEMALE_uterine_tubes','FEMALE_breasts','FEMALE_vulva'];
const reports=[];
function compact(pos,norm,indices){const map=new Map(),positions=[],normals=[],ind=new Uint32Array(indices.length);for(let i=0;i<indices.length;i++){const old=indices[i];if(!map.has(old)){map.set(old,positions.length/3);for(let a=0;a<3;a++){positions.push(pos[old*3+a]);normals.push(norm[old*3+a]);}}ind[i]=map.get(old);}return{pos:new Float32Array(positions),norm:new Int16Array(normals),ind};}
for(const [id,catalogFile,manifestFile] of [['male','data/anatomy-catalog.json','assets/anatomy/manifest-v22.json'],['female','data/anatomy-female.json','assets/anatomy/female-v23/manifest.json']]){
 const c=JSON.parse(fs.readFileSync(path.join(root,catalogFile),'utf8')),m=JSON.parse(fs.readFileSync(path.join(root,manifestFile),'utf8')),raw=zlib.gunzipSync(fs.readFileSync(path.join(root,m.chunks.lite.file))),groupMap=new Map(),meshRows=[],parts=[],meshIds=Object.keys(c.meshes),slotById=new Map(meshIds.map((id,i)=>[id,i]));
 const metadata={version:'anatomy-start-v25.1',id,catalog:{modelId:id,preview:true,version:c.version,source:c.source,attribution:c.attribution,licenseURL:c.licenseURL,triangles:c.triangles,packs:Object.fromEntries(Object.entries(c.packs).map(([id,p])=>[id,{name:p.name,color:p.color}])),relations:{isa:[],partof:[]}},meshes:meshRows,parts,groups:[]};
 for(const [key,meta]of Object.entries(c.meshes)){
  const p=c.parts[key]||{},zh=p.zh||knowledge.translations[meta.en?.toLowerCase()]||p.nameResolution?.zh;
  meshRows.push([key,meta.group,meta.en||p.en||key,zh||'',meta.fma||'',meta.provenance||'',meta.indices]);
 }
 for(const key of presets){const p=c.parts[key];if(p)parts.push([p.id,p.en,p.zh||knowledge.translations[p.en.toLowerCase()]||'',p.elements,p.groups,p.provenance||'']);}
 let triangles=0;
 for(const [key,d]of Object.entries(m.lite)){
  const pos=new Float32Array(raw.buffer,raw.byteOffset+d.offset,d.vertices*3),norm=new Int16Array(raw.buffer,raw.byteOffset+d.normalOffset,d.vertices*3),indices=d.indexWidth===2?new Uint16Array(raw.buffer,raw.byteOffset+d.indexOffset,d.indices):new Uint32Array(raw.buffer,raw.byteOffset+d.indexOffset,d.indices);
  const target=d.group==='breast'?indices.length:Math.max(12,Math.round(indices.length/3*.45))*3;let small=indices;if(target<indices.length){const [result]=S.simplify(new Uint32Array(indices),pos,3,target,.08,['Permissive']);if(result.length)small=result;}
  const geom=compact(pos,norm,small),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<geom.pos.length;i++){const a=i%3;lo[a]=Math.min(lo[a],geom.pos[i]);hi[a]=Math.max(hi[a],geom.pos[i]);}const slot=slotById.get(key);meshRows[slot].push(lo,hi);
  if(!groupMap.has(d.group))groupMap.set(d.group,[]);groupMap.get(d.group).push({slot,...geom,lo,hi});triangles+=geom.ind.length/3;
 }
 const payload=[];let offset=0;
 for(const [group,geoms]of groupMap){const nv=geoms.reduce((n,g)=>n+g.pos.length/3,0),ni=geoms.reduce((n,g)=>n+g.ind.length,0),v=Buffer.alloc(nv*12),ind=new Uint32Array(ni);let vi=0,ii=0;
  for(const g of geoms){for(let i=0;i<g.pos.length/3;i++){const at=(vi+i)*12;for(let a=0;a<3;a++){v.writeUInt16LE(g.hi[a]===g.lo[a]?0:Math.round((g.pos[i*3+a]-g.lo[a])/(g.hi[a]-g.lo[a])*65535),at+a*2);v.writeInt8(Math.round(g.norm[i*3+a]/32767*127),at+6+a);}v.writeUInt16LE(g.slot,at+10);}for(const i of g.ind)ind[ii++]=vi+i;vi+=g.pos.length/3;}
  const vb=Buffer.from(E.encodeVertexBufferLevel(v,nv,12,3)),ib=Buffer.from(E.encodeIndexBuffer(new Uint8Array(ind.buffer),ni,4));metadata.groups.push({group,vertices:nv,indices:ni,offset,vertexBytes:vb.length,indexBytes:ib.length});payload.push(vb,ib);offset+=vb.length+ib.length;
 }
 const header=Buffer.from(JSON.stringify(metadata)),length=Buffer.alloc(4);length.writeUInt32LE(header.length);const packed=zlib.gzipSync(Buffer.concat([length,header,...payload]),{level:9});fs.writeFileSync(path.join(out,id+'.bin.gz'),packed);
 fs.copyFileSync(path.join(root,catalogFile),path.join(out,id+'-catalog.json'));
 reports.push({id,bytes:packed.length,meshes:meshRows.length,previewMeshes:Object.keys(m.lite).length,triangles,groups:groupMap.size});
}
fs.copyFileSync(path.join(root,'../../tools/anatomy-build/node_modules/meshoptimizer/meshopt_decoder.mjs'),path.join(out,'meshopt-decoder.mjs'));
fs.copyFileSync(path.join(root,'../../tools/anatomy-build/node_modules/meshoptimizer/LICENSE.md'),path.join(out,'MESHOPT-LICENSE.md'));
const decoder=fs.readFileSync(path.join(out,'meshopt-decoder.mjs'),'utf8').replace('export { MeshoptDecoder };','');fs.writeFileSync(path.join(root,'assets/anatomy-start-worker.js'),decoder+'\n'+fs.readFileSync(path.join(root,'_lib/anatomy_start_worker.js'),'utf8'));
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));

