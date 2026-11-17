"""Build a small, vertex-clustered first-visit atlas from the shipped anatomy."""
import base64
import json
from pathlib import Path
import re
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
catalog=json.loads((ROOT/'data/anatomy-catalog.json').read_text(encoding='utf-8'))
groups=['skin','skeleton','heart','respiratory','digestive','urinary','nervous','arteries']
targets={name:catalog['parts'][fma]['elements'] for name,fma in {'heart':'FMA7088','lungs':'FMA7158','brain':'FMA50801','liver':'FMA7197','kidneys':'FMA7205','arteries':'FMA50720'}.items()}
result=[]
for group in groups:
    script=(ROOT/catalog['packs'][group]['file']).read_text(encoding='utf-8')
    encoded=re.search(r'=\s*"([A-Za-z0-9+/=]+)"\s*;',script).group(1)
    raw=base64.b64decode(encoded)
    for key,meta in catalog['meshes'].items():
        if meta['group']!=group: continue
        if group=='nervous' and key not in targets['brain']: continue
        positions=np.frombuffer(raw,dtype='<f4',count=meta['vertices']*3,offset=meta['offset']).reshape(-1,3)
        faces=np.frombuffer(raw,dtype='<u2' if meta['indexWidth']==2 else '<u4',count=meta['indices'],offset=meta['offset']+meta['vertices']*12).reshape(-1,3)
        cell=16 if group in {'skin','skeleton'} else 9
        _,mapping=np.unique(np.floor(positions/cell).astype(int),axis=0,return_inverse=True)
        counts=np.bincount(mapping)
        vertices=np.array([np.bincount(mapping,weights=positions[:,i])/counts for i in range(3)]).T
        reduced=mapping[faces]
        reduced=reduced[(reduced[:,0]!=reduced[:,1])&(reduced[:,1]!=reduced[:,2])&(reduced[:,0]!=reduced[:,2])]
        _,unique=np.unique(np.sort(reduced,axis=1),axis=0,return_index=True)
        reduced=reduced[unique]
        if len(reduced): result.append({'id':key,'group':group,'vertices':vertices.round(1).reshape(-1).tolist(),'indices':reduced.reshape(-1).tolist()})
data={'source':catalog['source'],'license':catalog['license'],'derived':'首访导览按空间顶点聚类简化；完整图谱保留原资源','targets':targets,'meshes':result}
output=ROOT/'assets/anatomy/intro.js'
output.write_text('window.IntroAnatomy='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
print(json.dumps({'meshes':len(result),'triangles':sum(len(m['indices'])//3 for m in result),'bytes':output.stat().st_size}))
