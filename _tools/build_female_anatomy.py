"""Import the pinned Female Anatomy Blast geometry for progressive local delivery.

The optional meshoptimizer build dependency lives outside the site in the D-drive
workspace. The final website consumes only the generated JSON and gzip assets.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
REVISION = 'fe9fa411909502d8c3fee957fc0827c0239184a8'
BASE = f'https://raw.githubusercontent.com/ThaddeusMercy/female-anatomy-blast/{REVISION}/'
SOURCE = WORKSPACE / 'scratch/female-anatomy/blast-2.2'


def acquire():
    SOURCE.mkdir(parents=True, exist_ok=True)

    def download(relative):
        target = SOURCE / Path(relative).name
        if not target.exists():
            for attempt in range(3):
                try:
                    target.write_bytes(urlopen(BASE + relative, timeout=60).read())
                    break
                except Exception:
                    if attempt == 2:
                        raise
        return target

    for name in ('atlas.json', 'ATTRIBUTION.md', 'MODEL-COVERAGE.md'):
        download('public/models/' + name if name == 'atlas.json' else 'public/' + name)
    atlas = json.loads((SOURCE / 'atlas.json').read_text(encoding='utf-8'))
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(download, ['public/models/' + Path(c['url']).name for c in atlas['chunks']]))


NODE_BUILD = r'''
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
const [root, source, simplifierPath] = process.argv.slice(2);
const {MeshoptSimplifier:S} = await import(pathToFileURL(simplifierPath).href);
await S.ready;
const out=path.join(root,'assets/anatomy/female-v23');fs.mkdirSync(out,{recursive:true});
const atlas=JSON.parse(fs.readFileSync(path.join(source,'atlas.json'),'utf8'));
const male=JSON.parse(fs.readFileSync(path.join(root,'data/anatomy-catalog.json'),'utf8'));
const revision='fe9fa411909502d8c3fee957fc0827c0239184a8';
const sourceUrl='https://github.com/ThaddeusMercy/female-anatomy-blast/tree/'+revision;
const groupMap={arterial:'arteries',venous:'veins',muscular:'muscles',skeletal:'skeleton',cardiac:'heart',sensory:'sensory',breast:'breast',lymphatic:'lymphatic'};
const extraPacks={sensory:{name:'感觉器官',color:'#99a8c1'},breast:{name:'乳房与乳腺',color:'#d5a298'},lymphatic:{name:'淋巴系统',color:'#91aa85'}};
const packs={};for(const p of atlas.parts){const g=groupMap[p.system]||p.system;if(!packs[g])packs[g]={...(male.packs[g]||extraPacks[g]),meshCount:0};packs[g].meshCount++;}
packs.reproductive.name='女性生殖系统';
for(const p of Object.values(packs)){delete p.file;delete p.sha256;delete p.bytes;}
const catalog={schema:1,modelId:'female',version:'Female Anatomy Blast 2.2',checkedOn:'2026-11-17',modelRelease:'2.2',attribution:'Female Anatomy Blast © Mercy Thaddeus; BodyParts3D © DBCLS; female reference organs © Kristen Browne and Heidi Schlehlein / HuBMAP. Adapted under CC BY 4.0.',license:'CC BY 4.0',source:sourceUrl,sourceRevision:revision,licenseURL:'https://creativecommons.org/licenses/by/4.0/',units:'mm',transform:'source metres/Y-up (x,y,z) -> millimetres/Z-up (1000x,-1000z,1000y); source fit retained',triangles:0,vertices:0,unnamedMeshCount:0,sourceHeaderUnnamedMeshCount:0,resolvedNameCount:0,unresolvedNameCount:0,manifest:'/assets/anatomy/female-v23/manifest.json',coverage:atlas.coverage,meshes:{},parts:{},relations:{isa:[],partof:[]},packs};
const manifest={version:'female-anatomy-blast-2.2-v23.1',modelId:'female',source:sourceUrl,license:'CC BY 4.0',chunks:{},meshes:{},lite:{}};
const sourceChunks=atlas.chunks.map(c=>zlib.gunzipSync(fs.readFileSync(path.join(source,path.basename(c.url)))));
const geometries=new Map();
function readPart(p){
 const b=sourceChunks[p.chunk],pos=new Float32Array(p.vertexCount*3),ind=new Uint32Array(p.indexCount);
 for(let i=0;i<pos.length;i+=3){pos[i]=b.readFloatLE(p.positions+i*4)*1000;pos[i+1]=-b.readFloatLE(p.positions+(i+2)*4)*1000;pos[i+2]=b.readFloatLE(p.positions+(i+1)*4)*1000;}
 for(let i=0;i<ind.length;i++)ind[i]=b.readUInt32LE(p.indices+i*4);
 return {pos,ind};
}
function normals(pos,ind){
 const n=new Float64Array(pos.length);
 for(let i=0;i<ind.length;i+=3){const a=ind[i]*3,b=ind[i+1]*3,c=ind[i+2]*3;
  const ux=pos[c]-pos[b],uy=pos[c+1]-pos[b+1],uz=pos[c+2]-pos[b+2],vx=pos[a]-pos[b],vy=pos[a+1]-pos[b+1],vz=pos[a+2]-pos[b+2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
  for(const k of [a,b,c]){n[k]+=x;n[k+1]+=y;n[k+2]+=z;}}
 const result=new Int16Array(pos.length);for(let i=0;i<n.length;i+=3){const length=Math.hypot(n[i],n[i+1],n[i+2])||1;for(let k=0;k<3;k++)result[i+k]=Math.round(n[i+k]/length*32767);}return result;
}
function compact(pos,ind){const mapping=new Map(),v=[],indices=new Uint32Array(ind.length);for(let i=0;i<ind.length;i++){const old=ind[i];if(!mapping.has(old)){mapping.set(old,v.length/3);v.push(pos[old*3],pos[old*3+1],pos[old*3+2]);}indices[i]=mapping.get(old);}return {pos:new Float32Array(v),ind:indices};}
function bounds(pos){const b=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];for(let i=0;i<pos.length;i++) {const j=i%3;b[0][j]=Math.min(b[0][j],pos[i]);b[1][j]=Math.max(b[1][j],pos[i]);}return b;}
class Chunk {
 constructor(){this.segments=[];this.bytes=0;this.ids=[];}
 append(data,align=4){const padding=(align-this.bytes%align)%align;if(padding){this.segments.push(Buffer.alloc(padding));this.bytes+=padding;}const offset=this.bytes;const b=Buffer.from(data.buffer,data.byteOffset,data.byteLength);this.segments.push(b);this.bytes+=b.length;return offset;}
 mesh(id,g,pos,ind){const indexWidth=pos.length/3<=65535?2:4,typed=indexWidth===2?new Uint16Array(ind):ind;const offset=this.append(pos),normalOffset=this.append(normals(pos,ind),2),indexOffset=this.append(typed,indexWidth);this.ids.push(id);return {offset,normalOffset,indexOffset,vertices:pos.length/3,indices:ind.length,indexWidth,group:g};}
 write(name){const data=zlib.gzipSync(Buffer.concat(this.segments),{level:6});fs.writeFileSync(path.join(out,name+'.bin.gz'),data);manifest.chunks[name]={file:'/assets/anatomy/female-v23/'+name+'.bin.gz',bytes:data.length};}
}
for(const p of atlas.parts){const g=groupMap[p.system]||p.system,{pos,ind}=readPart(p);geometries.set(p.id,{pos,ind});
 const meta={id:p.id,fma:p.conceptId?.replace('FMA:','FMA'),en:p.name,group:g,vertices:pos.length/3,indices:ind.length,indexWidth:pos.length/3<=65535?2:4,bounds:bounds(pos),provenance:p.provenance,sourceId:p.sourceId||p.id,sourceUrl:p.sourceUrl,sourceDescription:p.description||'',mapping:'Female Anatomy Blast '+revision};
 catalog.meshes[p.id]=meta;catalog.vertices+=meta.vertices;catalog.triangles+=ind.length/3;
}
for(const g of Object.keys(packs)){let chunk=new Chunk(),count=0;const flush=()=>{if(!chunk.bytes)return;const name=g+'-'+String(count++).padStart(3,'0');chunk.write(name);for(const id of chunk.ids)manifest.meshes[id].chunk=name;chunk=new Chunk();};
 for(const p of atlas.parts){if((groupMap[p.system]||p.system)!==g)continue;const {pos,ind}=geometries.get(p.id),estimated=pos.length*6+ind.length*(pos.length/3<=65535?2:4);if(chunk.bytes&&chunk.bytes+estimated>1048576)flush();manifest.meshes[p.id]=chunk.mesh(p.id,g,pos,ind);}flush();}
// Every source piece stays represented in the preview, including female-specific
// structures. Edge collapse retains surfaces instead of discarding triangles.
let lite=new Chunk();const previewStats={};
for(const p of atlas.parts){const {pos,ind}=geometries.get(p.id),g=groupMap[p.system]||p.system;
 const targetTriangles={arteries:12,veins:12,nervous:20,muscles:48,skeleton:70,heart:60,reproductive:70,breast:1000,urinary:80,respiratory:30,digestive:55,sensory:30,connective:24,lymphatic:16,endocrine:40}[g]||40;
 const [simplified,error]=S.simplify(ind,pos,3,Math.min(ind.length,targetTriangles*3),g==='breast'?.015:.2,['Permissive']);
 const small=compact(pos,simplified.length?simplified:ind);manifest.lite[p.id]={...lite.mesh(p.id,g,small.pos,small.ind),chunk:'lite'};
 previewStats[g]=(previewStats[g]||0)+small.ind.length/3;
}
lite.write('lite');
function addPart(id,en,elements,source={}){elements=[...new Set(elements)].filter(x=>catalog.meshes[x]);if(!elements.length)return;const groups=[...new Set(elements.map(x=>catalog.meshes[x].group))],kinds=[...new Set(elements.map(x=>catalog.meshes[x].provenance))];catalog.parts[id]={id,en,elements,groups,mapping:'Female Anatomy Blast source hierarchy',provenance:kinds.length===1?kinds[0]:'mixed',provenanceKinds:kinds,...source};}
for(const c of atlas.concepts)addPart(c.id,c.name,c.elements,{sourceId:c.sourceId||c.id});
for(const p of atlas.parts){if(!catalog.parts[p.id])addPart(p.id,p.name,[p.id],{fma:p.conceptId?.replace('FMA:','FMA'),sourceUrl:p.sourceUrl,sourceDescription:p.description||''});}
for(const [id,p]of Object.entries(male.parts)){if(!catalog.parts[id]&&id.startsWith('FMA'))addPart(id,p.en,p.elements,{sourceId:id,mapping:'BodyParts3D compound membership intersected with retained source IDs'});}
for(const type of ['isa','partof'])catalog.relations[type]=male.relations[type].filter(([a,b])=>catalog.parts[a]&&catalog.parts[b]);
// Selectable female organ groups supplement the source's individual pieces.
const groups=[['FEMALE_uterus','uterus','子宫',/uterus|uterine (?:cervix|fundus|body)|endometrium|myometrium/i],['FEMALE_ovaries','ovaries','卵巢',/ovary|ovarian/i],['FEMALE_uterine_tubes','uterine tubes','输卵管',/uterine tube|fallopian tube/i],['FEMALE_breasts','breasts and mammary glands','乳房与乳腺',/mammary|lactiferous|nipple|breast/i],['FEMALE_vulva','vulva','外阴',/clitor|labia|vulva|vestibul|bartholin|skene|mons pubis/i]];
for(const [id,en,zh,regex]of groups)addPart(id,en,atlas.parts.filter(p=>regex.test(p.name)||(id==='FEMALE_breasts'&&p.system==='breast')).map(p=>p.id),{zh});
const translations={'vagina':'阴道','cervicovaginal junction':'宫颈阴道交界','uterine cervix':'子宫颈','body of uterus':'子宫体','fundus of uterus':'子宫底','cornua':'子宫角','lower uterine segment':'子宫下段','posterior wall of uterus':'子宫后壁','anterior wall of uterus':'子宫前壁','internal cervical os':'宫颈内口','external cervical os':'宫颈外口','broad ligament of uterus':'子宫阔韧带','cardinal ligament':'子宫主韧带','uterovesical pouch':'膀胱子宫陷凹','abdominal ostium of uterine tube':'输卵管腹腔口','glans of clitoris':'阴蒂头','body of clitoris':'阴蒂体','mons pubis':'阴阜','vulval vestibule boundary':'阴道前庭边界','endometrium':'子宫内膜','myometrium':'子宫肌层'};
for(const [side,zh]of [['left','左'],['right','右']]){
 for(const [name,cn]of Object.entries({'ovary':'卵巢','uterine artery':'子宫动脉','uterine vein':'子宫静脉','hip bone':'髋骨','round ligament of uterus':'子宫圆韧带','uterosacral ligament':'子宫骶韧带','ovarian ligament':'卵巢固有韧带','mesosalpinx':'输卵管系膜','mesovarium':'卵巢系膜','areolar tubercle':'乳晕结节','nipple':'乳头','female areola':'乳晕','mammary lobe':'乳腺叶','main lactiferous duct':'主输乳管','lactiferous sinus':'输乳管窦','crus of clitoris':'阴蒂脚','labium majus (labia majora)':'大阴唇','labium minus (labia minora)':'小阴唇','bulb of vestibule':'前庭球','greater vestibular (bartholin) gland':'前庭大腺'}))translations[side+' '+name]=zh+cn;
 for(const [name,cn]of Object.entries({'ampulla':'壶腹部','isthmus':'峡部','fimbria':'伞','infundibulum':'漏斗部'}))translations[name+' of '+side+' uterine tube']=zh+'输卵管'+cn;
 translations['suspensory ligament of '+side+' ovary']=zh+'卵巢悬韧带';translations['suspensory ligament of '+side+' breast']=zh+'乳房悬韧带';translations['interlobar adipose tissue of '+side+' mammary gland']=zh+'乳腺叶间脂肪组织';
}
for(const p of Object.values(catalog.parts)){const plain=p.en.replace(/ \(schematic\)$/i,'').toLowerCase();if(translations[plain])p.zh=translations[plain];}
for(const f of ['ATTRIBUTION.md','MODEL-COVERAGE.md'])fs.copyFileSync(path.join(source,f),path.join(out,f));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest));
fs.writeFileSync(path.join(out,'catalog.json'),JSON.stringify(catalog));
fs.writeFileSync(path.join(root,'data/anatomy-female.json'),JSON.stringify(catalog));
const summary={version:manifest.version,sourceRevision:revision,meshes:Object.keys(catalog.meshes).length,concepts:atlas.concepts.length,selectableEntries:Object.keys(catalog.parts).length,triangles:catalog.triangles,previewTriangles:Object.values(previewStats).reduce((a,b)=>a+b,0),previewTrianglesByGroup:previewStats,liteBytes:manifest.chunks.lite.bytes,chunks:Object.keys(manifest.chunks).length,bytes:Object.values(manifest.chunks).reduce((n,c)=>n+c.bytes,0),maxChunkBytes:Math.max(...Object.values(manifest.chunks).map(c=>c.bytes)),coverage:atlas.coverage,transform:catalog.transform};
fs.writeFileSync(path.join(root,'data/anatomy-female-build.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
'''


def build(offline=False):
    if not offline:
        acquire()
    simplifier = WORKSPACE / 'tools/anatomy-build/node_modules/meshoptimizer/index.js'
    subprocess.run(['node', '--input-type=module', '-', str(ROOT), str(SOURCE), str(simplifier)],
                   input=NODE_BUILD, text=True, encoding='utf-8', check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Reuse the pinned source download in the workspace')
    build(parser.parse_args().offline)
