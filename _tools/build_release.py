"""Rebuild the single-file application offline from bundled source snapshots.

No network and no machine-specific paths. Running twice produces the same file.
"""
from collections import Counter
from datetime import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import os
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
LIB=ROOT/'_lib'

TOPICS=[('基础模型',r'foundation model|self-supervised|vision transformer|biomedclip|radimagenet|pretrain'),
 ('大语言模型',r'large language model|\bllm\b|\bgpt|chatgpt'),('联邦学习',r'federated|privacy-?preserving'),
 ('病理影像',r'pathomic|whole slide|histopatholog|computational patholog|digital patholog'),
 ('报告规范',r'tripod|clear\b|radiomics quality score|\brqs\b|\bmetrics\b|guideline|checklist|reporting'),
 ('复现性',r'reproduc|repeatab|robust|stabil|harmoni|variance|batch effect'),
 ('分割变异',r'segment|inter-?observer|delineat|contour|annotat'),
 ('外部验证',r'external valid|overfit|generali[sz]|multi-?cent|multi-?institution'),
 ('特征工程',r'feature selection|handcraft|\bibsi\b|pyradiomics|wavelet|texture'),
 ('深度学习',r'deep learning|neural|convolution|transformer'),
 ('临床应用',r'prognos|predict|diagnos|survival|response|classif|screen')]

def load(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def clean(text):
    decoded=html.unescape(str(text or ''))
    return re.sub(r'</?[A-Za-z][^>]*>',' ',decoded).strip()
def normalize(record,level=1):
    title=clean(record.get('title')).rstrip('.').strip()
    if not title:return None
    mapping={'pmid':'pmid','pmcid':'pmcid','doi':'doi','journal':'journalTitle','year':'pubYear',
             'vol':'journalVolume','issue':'issue','pages':'pageInfo','firstdate':'firstPublicationDate'}
    doc={field:str(record.get(source) or '').strip() for field,source in mapping.items()}
    authors=clean(record.get('authorString'))
    parts=[x.strip() for x in authors.split(',') if x.strip()]
    doc.update(title=title,authors=', '.join(parts[:3])+(', et al.' if len(parts)>3 else ''),
               authors_full=authors,cited=int(record.get('citedByCount') or 0),
               oa=str(record.get('isOpenAccess','')).upper()=='Y',level=level,
               topics=[label for label,pattern in TOPICS if re.search(pattern,title,re.I)])
    doc['key']=doc['pmid'] or doc['doi'] or doc['pmcid'] or title[:60]
    return doc

def js_json(data):
    return json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')

def build():
    if not (ROOT/'assets/anatomy/manifest-v22.json').exists():
        from build_anatomy_binary import build as build_anatomy_binary
        build_anatomy_binary()
    review_date=os.environ.get('HELIX_REVIEW_DATE',datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat())
    queries=load(LIB/'queries.json')
    docs={}
    for query in queries:
        data=load(LIB/query['source_file'])
        records=data.get('resultList',{}).get('result',data.get('result',[]))
        for record in records:
            doc=normalize(record)
            if doc:docs.setdefault(doc['key'],doc)
    for record in load(LIB/'curated.json'):
        doc=normalize(record,3)
        if doc:docs[doc['key']]=doc
    checks={}
    source_abstracts={}
    corrections=[]
    pending_dates=[]
    retained_pending={r['key'] for r in load(ROOT/'data/date-quarantine.json')['records']}
    for file in sorted((ROOT/'data/metadata_checks').glob('europepmc-*.json')):
        record=load(file)['resultList']['result'][0]
        key=record['pmid']
        if key not in docs:
            continue
        current=docs[key]
        ji=record.get('journalInfo',{})
        updates={'title':clean(record.get('title')).rstrip('.').strip(),'doi':record.get('doi',''),
                 'pmcid':record.get('pmcid',''),'year':record.get('pubYear',''),
                 'vol':ji.get('volume',''),'issue':ji.get('issue',''),'pages':record.get('pageInfo',''),
                 'firstdate':record.get('firstPublicationDate','')}
        for field,value in updates.items():
            value=str(value or '')
            if current.get(field,'')!=value:
                corrections.append({'pmid':key,'field':field,'snapshot':current.get(field,''),'reviewed_value':value})
                current[field]=value
        if record.get('authorString'):
            current['authors_full']=clean(record['authorString'])
            authors=[part.strip() for part in current['authors_full'].split(',') if part.strip()]
            current['authors']=', '.join(authors[:3])+(', et al.' if len(authors)>3 else '')
        current['first_index_date']=str(record.get('firstIndexDate') or '')
        current['date_pending']=bool(current.get('firstdate') and (key in retained_pending or current['firstdate']>review_date))
        if current['date_pending']:pending_dates.append(key)
        text=clean(record.get('abstractText'))
        if text:source_abstracts[key]=text
        checks[key]={'checked_on':'2026-11-13','scope':'bibliographic_metadata',
                     'source':'Europe PMC','first_publication_date':record.get('firstPublicationDate','')}
        # Use this later independently fetched date rather than a curated print date.
        if key in docs and record.get('firstPublicationDate'):
            docs[key]['firstdate']=record['firstPublicationDate']
    recent_path=ROOT/'data/recent-europepmc-2025-2026.json'
    recent=load(recent_path) if recent_path.exists() else {}
    for record in recent.get('new_candidates',[])+recent.get('refreshed',[]):
        if not ('2025-01-01' <= record.get('firstPublicationDate','') <= '2026-11-14'):
            continue
        doc=normalize(record)
        if not doc:continue
        doc['level']=docs.get(doc['key'],{}).get('level',1)
        journal=record.get('journalInfo',{})
        doc.update(journal=journal.get('journal',{}).get('title',''),vol=str(journal.get('volume') or ''),issue=str(journal.get('issue') or ''),date_pending=doc['key'] in retained_pending)
        doc['source_url']='https://europepmc.org/article/MED/'+doc['pmid']
        doc['updated_on']='2026-11-14'
        docs[doc['key']]=doc
        source_abstracts[doc['key']]=clean(record['abstractText'])
        checks[doc['key']]={'checked_on':'2026-11-14','scope':'bibliographic_metadata','source':'Europe PMC','first_publication_date':doc['firstdate']}
    expansion_path=ROOT/'data/literature-expansion-v25.json'
    if expansion_path.exists():
        seen_doi={d['doi'].casefold() for d in docs.values() if d.get('doi')}
        expansion=load(expansion_path)['records']
        topics=sorted({topic for d in expansion for topic in d.get('topics',[])})
        buckets={topic:iter([d for d in expansion if topic in d.get('topics',[])]) for topic in topics}
        selected={}
        while buckets and len(selected)<20000:
            for topic in list(buckets):
                item=next(buckets[topic],None)
                if item is None:del buckets[topic];continue
                selected.setdefault(item['key'],item)
                if len(selected)>=20000:break
        for item in selected.values():
            key=item['key']
            if key in docs or (item.get('doi') and item['doi'].casefold() in seen_doi):continue
            doc={k:v for k,v in item.items() if k!='abstract'}
            docs[key]=doc
            if item.get('doi'):seen_doi.add(item['doi'].casefold())
            if item.get('abstract'):source_abstracts[key]=item['abstract']
            checks[key]={'checked_on':item['source_checked_at'][:10],'scope':'bibliographic_metadata','source':'Europe PMC','first_publication_date':item['firstdate']}
    audit_path=ROOT/'data/literature-audit/index.json'
    if audit_path.exists():
        for audit in load(audit_path)['records']:
            doc=docs.get(audit['key'])
            if doc and audit.get('metadata_status')=='conflict':
                for field,target in [('publication_date','firstdate'),('title','title'),('doi','doi')]:
                    checked=audit.get('fields',{}).get(field,{})
                    if checked.get('status')=='conflict' and checked.get('official'):
                        corrections.append({'key':audit['key'],'field':target,'old':doc.get(target),'new':checked['official'],'source':'data/literature-audit/records/'+audit['key']+'.json'})
                        doc[target]=checked['official']
    rows=sorted(docs.values(),key=lambda d:(-d['cited'],d['year'],d['key']))
    pending_dates=[d['key'] for d in rows if d.get('date_pending')]
    abstracts={}
    for name in ('abstracts.json','abstracts_pm.json'):
        for key,value in load(LIB/name)['byKey'].items():
            text=clean(value.get('abstract'))
            # Retain the original snapshot only when it declares no truncation.
            reported=value.get('abstractLen')
            if key in docs and text and (not reported or int(reported)<=len(value.get('abstract',''))):
                abstracts[key]=text
    abstracts.update(source_abstracts)
    translations={key:clean(value) for key,value in load(LIB/'zh.json')['byKey'].items() if key in docs and value}
    translation_sources={}
    for name in ('abstracts.json','abstracts_pm.json'):
        for key,value in load(LIB/name)['byKey'].items():
            if key in translations:translation_sources[key]=clean(value.get('abstract'))
    recent_zh_path=LIB/'recent-zh.json'
    if recent_zh_path.exists():
        for key,value in load(recent_zh_path).get('byKey',{}).items():
            if key in abstracts:
                translations[key]=value
                translation_sources[key]=abstracts[key]
    (ROOT/'data/reader-content.json').write_text(json.dumps({'abstracts':abstracts,'translations':translations,'translation_sources':translation_sources},ensure_ascii=False),encoding='utf-8')
    focus=load(LIB/'focus.json')
    def normalized(text):return re.sub(r'\W','',clean(text)).lower()
    for doc in focus.values():
        source=abstracts.get(doc['pmid'],'') if doc['quoteSource']=='abstract' else doc['title']
        parts=[piece.strip() for piece in clean(doc['quote']).split('…') if piece.strip()]
        if not source or not all(normalized(part) in normalized(source) for part in parts):
            raise ValueError('Quote provenance does not match: '+doc['pmid'])
    years=Counter(d['year'] for d in rows)
    library={'generated':'2026-11-11','revised':'2026-11-14',
        'source':f"Europe PMC saved search snapshots; {len(queries)} registered queries",
        'note':'题录经去重、作者名缩写整理；完整接口摘要与摘录来源分开记录；非系统综述全集。',
        'queries':{q['id']:q['query'] for q in queries},'total':len(rows),
        'level_counts':dict(Counter(str(d['level']) for d in rows)),
        'years':dict(sorted(years.items(),reverse=True)),
        'docs':rows}
    (LIB/'lib.json').write_text(json.dumps(library,ensure_ascii=False,indent=1),encoding='utf-8')
    stats={'records':len(rows),'queries':len(queries),'abstracts':len(abstracts),'translations':len(translations),
           'metadata_checked':len(checks),'focus':sum(d['level']>=3 for d in rows),
           'abstract_only':sum(d['level']<3 and d['key'] in abstracts for d in rows),
           'metadata_only':sum(d['level']<3 and d['key'] not in abstracts for d in rows),
           'snapshot_date':'2026-11-11','review_date':'2026-11-14',
           'date_pending':len(pending_dates),'searchable':len(rows)-len(pending_dates)}
    template=(ROOT/'app.template.html').read_text(encoding='utf-8')
    values={'LIB':rows,'ABS':abstracts,'ZH':translations,'ZHSRC':translation_sources,'DOCS':focus,'VERIFY':checks,
            'SOURCES':load(ROOT/'data/science-sources.json')['sources']}
    for name,value in values.items():template=template.replace('{{'+name+'}}',js_json([] if name=='LIB' else value if name=='SOURCES' else {}))
    template=template.replace('{{SITEUI}}',(LIB/'site_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{BROWSERCOMPUTE}}',(LIB/'browser_compute.js').read_text(encoding='utf-8') if (LIB/'browser_compute.js').exists() else '')
    template=template.replace('{{LIBRARYLOADING}}',(LIB/'library_loading.js').read_text(encoding='utf-8')+'\n'+(LIB/'public_search.js').read_text(encoding='utf-8')+'\n'+(LIB/'my_papers.js').read_text(encoding='utf-8'))
    template=template.replace('{{ACCOUNTUI}}',(LIB/'account_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{AIQ}}',(LIB/'aiq.js').read_text(encoding='utf-8'))
    template=template.replace('{{RESEARCHCORE}}',(LIB/'research_core.js').read_text(encoding='utf-8'))
    template=template.replace('{{THREE}}','')
    template=template.replace('{{METHODS}}',js_json(load(ROOT/'data/model-sources.json')['sources']))
    template=template.replace('{{SIMCORE}}',(LIB/'simulation_core.js').read_text(encoding='utf-8'))
    image_manifest=(ROOT/'assets/imaging/v24/manifest.js').read_text(encoding='utf-8')+'\n' if (ROOT/'assets/imaging/v24/manifest.js').exists() else ''
    template=template.replace('{{SIMUI}}',image_manifest+((LIB/'real_imaging.js').read_text(encoding='utf-8')+'\n' if (LIB/'real_imaging.js').exists() else '')+(LIB/'simulation_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{REVIEWCHECKLISTS}}',(LIB/'review_checklists.js').read_text(encoding='utf-8'))
    anatomy_data='var ANATOMY={parts:{},meshes:{},packs:{},relations:{isa:[],partof:[]},triangles:0,source:"",attribution:"",licenseURL:""};\nvar ANATOMY_KNOWLEDGE='+js_json(load(ROOT/'data/anatomy-knowledge.json'))+';\n'
    template=template.replace('{{ANATOMYMODEL}}','')
    template=template.replace('{{ANATOMYUI}}','')
    anatomy_runtime=anatomy_data+(LIB/'anatomy_open_model.js').read_text(encoding='utf-8')+'\n'+(LIB/'anatomy_open_ui.js').read_text(encoding='utf-8')+'\nwindow.AnatomyRuntimeReady=true;'
    (ROOT/'assets/anatomy-runtime.js').write_text(anatomy_runtime,encoding='utf-8')
    template=template.replace('{{APIMODELS}}',(LIB/'api_models_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{READERUI}}',(LIB/'notes_ui.js').read_text(encoding='utf-8')+'\n'+(LIB/'translation_ui.js').read_text(encoding='utf-8')+'\n'+(LIB/'reader_translation.js').read_text(encoding='utf-8')+'\n'+((LIB/'review_workspace.js').read_text(encoding='utf-8')+'\n' if (LIB/'review_workspace.js').exists() else '')+(LIB/'reader_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{PDFUI}}',(LIB/'pdf_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{RESEARCHUI}}',(LIB/'research_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{FINALUI}}',(LIB/'final_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{UPGRADEUI}}',(LIB/'upgrade_ui.js').read_text(encoding='utf-8'))
    template=template.replace('{{WORKCSS}}',(LIB/'workbench.css').read_text(encoding='utf-8')+'\n'+(LIB/'simulation.css').read_text(encoding='utf-8')+'\n'+(LIB/'research_workspaces.css').read_text(encoding='utf-8')+'\n'+(LIB/'reader_api.css').read_text(encoding='utf-8')+'\n'+(LIB/'pdf_ui.css').read_text(encoding='utf-8')+'\n'+(LIB/'anatomy_open.css').read_text(encoding='utf-8')+'\n'+(LIB/'final_ui.css').read_text(encoding='utf-8')+'\n'+(LIB/'notes_ui.css').read_text(encoding='utf-8')+'\n'+(LIB/'account_ui.css').read_text(encoding='utf-8')+'\n'+(LIB/'site_ui.css').read_text(encoding='utf-8')+('\n'+(LIB/'browser_compute.css').read_text(encoding='utf-8') if (LIB/'browser_compute.css').exists() else ''))
    template=template.replace('</style>', '\n'+(LIB/'upgrade_ui.css').read_text(encoding='utf-8')+'\n</style>',1)
    template=template.replace('</style>','\n'+(LIB/'library_loading.css').read_text(encoding='utf-8')+'\n'+((LIB/'review_workspace.css').read_text(encoding='utf-8') if (LIB/'review_workspace.css').exists() else '')+'\n</style>',1)
    (ROOT/'helix-demo.html').write_text(template,encoding='utf-8')
    assets=ROOT/'assets'
    (assets/'upgrade.js').write_text((LIB/'upgrade_ui.js').read_text(encoding='utf-8'),encoding='utf-8')
    (assets/'upgrade.css').write_text((LIB/'upgrade_ui.css').read_text(encoding='utf-8'),encoding='utf-8')
    (assets/'three.min.js').write_text((LIB/'vendor/three-0.160.1.min.js').read_text(encoding='utf-8'),encoding='utf-8')
    (assets/'imaging').mkdir(exist_ok=True)
    for name in ('research','simulation'):
        (assets/'imaging'/(name+'-core.js')).write_text((LIB/(name+'_core.js')).read_text(encoding='utf-8'),encoding='utf-8')
    packs=load(ROOT/'data/anatomy-catalog.json')['packs']
    (assets/'intro-config.js').write_text('var ANATOMY={packs:'+js_json(packs)+'};',encoding='utf-8')
    (ROOT/'data/stats.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'data/metadata_corrections.json').write_text(json.dumps(corrections,ensure_ascii=False,indent=2),encoding='utf-8')
    return stats

if __name__=='__main__':print(json.dumps(build(),ensure_ascii=False,indent=2))
