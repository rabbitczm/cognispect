"""Build an additive D1 public literature index; preserve account data and article edits."""
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def build():
    library=json.loads((ROOT/'_lib/lib.json').read_text(encoding='utf-8'))
    content=json.loads((ROOT/'data/reader-content.json').read_text(encoding='utf-8'))
    rows=[]
    aliases={}
    for record in sorted(library['docs'],key=lambda d:(-d.get('level',1),-d.get('cited',0))):
        d={**record}
        keys=[('key',str(d['key']))]
        for name in ['pmid','doi']:
            if d.get(name):keys.append((name,str(d[name]).casefold().strip()))
        title=re.sub(r'[^\w]','',d['title'].casefold())
        author=re.sub(r'[^\w]','',(d.get('authors_full') or d.get('authors') or '').split(',')[0].casefold())
        keys.append(('title',title+'|'+str(d.get('year',''))+'|'+author))
        existing=next((aliases[k] for k in keys if k in aliases),None)
        if existing is not None:
            previous=rows[existing]
            previous.setdefault('alternate_sources',[]).append({k:d.get(k,'') for k in ['pmid','doi','journal','source_url']})
            for k in keys:aliases[k]=existing
            continue
        for k in keys:aliases[k]=len(rows)
        d['abstract']=content['abstracts'].get(d['key'],'')
        d['has_zh']=bool(content['translations'].get(d['key']))
        if d['has_zh']:
            d['zh']=content['translations'][d['key']]
            d['translation_source']=content['translation_sources'].get(d['key'],'')
        rows.append(d)
    out=ROOT/'scratch/literature-v25';out.mkdir(parents=True,exist_ok=True)
    def quote(v):return 'NULL' if v is None else "'"+str(v).replace('\r',' ').replace('\n',' ').replace("'","''")+"'"
    statements=[]
    for d in rows:
        mesh=d.get('mesh') or []
        values=[d['key'],d.get('pmid',''),d.get('doi',''),d.get('year',''),d.get('firstdate',''),d['title'],d.get('authors_full') or d.get('authors',''),d.get('journal',''),d['abstract'],' '.join(mesh) if isinstance(mesh,list) else mesh,json.dumps(d,ensure_ascii=False,separators=(',',':'))]
        columns='paper_key,pmid,doi,year,firstdate,title,authors,journal,abstract,mesh,payload'
        statement='INSERT INTO literature_search_records('+columns+') SELECT '+','.join(map(quote,values))+" WHERE NOT EXISTS(SELECT 1 FROM articles WHERE key="+quote(d['key'])+") ON CONFLICT(paper_key) DO UPDATE SET "+','.join(c+'=excluded.'+c for c in columns.split(',')[1:])+" WHERE literature_search_records.payload<>excluded.payload;"
        statements.append(statement)
    statements.append('UPDATE catalog_revision SET revision=revision+1 WHERE id=1;')
    (out/'seed.sql').write_text('\n'.join(statements),encoding='utf-8')
    (out/'records.json').write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    result={'records':len(rows),'merged_duplicates':len(library['docs'])-len(rows),'sql_bytes':(out/'seed.sql').stat().st_size}
    print(json.dumps(result))
    return result

if __name__=='__main__':build()
