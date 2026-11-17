"""Prepare a resumable, source-paired scholarly publication inventory."""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from publication_library import classify_license, normalize_jats, merge_translations
OUT=ROOT/'data/publication'

def read(path, default=None):
    return json.loads(path.read_text('utf-8-sig')) if path.exists() else default

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    tmp.replace(path)

def today():return dt.datetime.now(dt.timezone.utc).isoformat()

def abstract_state(source,translated,paired):
    if not source:return 'no_source_abstract'
    if not translated:return 'missing'
    if paired==source:return 'aligned_draft'
    if paired and paired in source:return 'partial_draft'
    return 'source_changed'

def inventory():
    lib=read(ROOT/'_lib/lib.json')['docs']; reader=read(ROOT/'data/reader-content.json')
    drafts=read(OUT/'translation-drafts.json',{'records':{}})['records']
    prior={x['key']:x for x in read(OUT/'manifest.json',{'records':[]})['records']}
    progress=read(OUT/'translation-progress.json',{})
    publisher={r['key']:r for r in read(OUT/'publisher-candidates.json',{'records':[]})['records']}
    records=[]
    for d in lib:
        key=d['key']; snapshot=ROOT/'data/metadata_checks'/f'europepmc-{d["pmid"]}.json'
        if not snapshot.exists():snapshot=OUT/'sources/metadata'/f'europepmc-{d["pmid"]}.json'
        meta=read(snapshot,{})
        raw=next((x for x in meta.get('resultList',{}).get('result',[]) if str(x.get('id'))==d['pmid']),{})
        if not d.get('pmcid') and raw.get('pmcid'):d=dict(d,pmcid=raw['pmcid'])
        abstract=reader['abstracts'].get(key,''); zh=reader['translations'].get(key,''); paired=reader['translation_sources'].get(key,'')
        draft=drafts.get(key,{})
        if draft.get('abstract',{}).get('en')==abstract:
            zh=draft['abstract']['zh'];paired=abstract
        record={'key':key,'pmid':d['pmid'],'pmcid':d.get('pmcid',''),'doi':d.get('doi',''),
                'title':d['title'],'authors':d.get('authors_full',d.get('authors','')),'journal':d.get('journal',''),'year':d.get('year',''),'title_zh':draft.get('title',{}).get('zh',''),'title_translation_status':'draft' if draft.get('title',{}).get('en')==d['title'] and draft.get('title',{}).get('zh') else 'missing',
                'abstract_status':abstract_state(abstract,zh,paired),'abstract_review_status':draft.get('abstract',{}).get('review_status','not_reviewed'),'title_review_status':draft.get('title',{}).get('review_status','not_reviewed'),
                'date_status':'pending' if d.get('date_pending') else 'retained','publication_date':d.get('firstdate'),
                'source_url':f'https://europepmc.org/article/MED/{d["pmid"]}',
                'source_metadata':{'snapshot':str(snapshot.relative_to(ROOT)).replace('\\','/') if snapshot.exists() else None,'retrieved_on':meta.get('retrieved_on'),'revision_date':raw.get('dateOfRevision'),'first_index_date':raw.get('firstIndexDate',d.get('first_index_date')),'fulltext_received_date':raw.get('fullTextReceivedDate')},
                'license':dict(classify_license(raw.get('license','')),evidence='Europe PMC core metadata'),
                'fulltext_alternatives':raw.get('fullTextUrlList',{}).get('fullTextUrl',[]),
                'fulltext_url':f'https://europepmc.org/articles/{d["pmcid"]}' if d.get('pmcid') else (f'https://doi.org/{d["doi"]}' if d.get('doi') else ''),
                'fulltext_status':'pending_fetch' if d.get('pmcid') else 'no_pmc_identifier','fulltext_translation_status':'missing','fulltext_review_status':'not_reviewed','publication_status':'draft','public':False,
                'is_open_access_metadata':d.get('oa',False)}
        old=prior.get(key,{})
        for field in ('fulltext_status','fulltext_translation_status','fulltext_review_status','document_path','source_xml','fetch','body_paragraph_count','body_word_count','table_count','figure_count','formula_count','reference_count','translated_paragraph_count'):
            if field in old:record[field]=old[field]
        if old.get('source_xml'):record['license']=old['license']
        record.update(progress.get(key,{}))
        if key in publisher:record['publisher_retrieval']=publisher[key]
        records.append(record)
    return records

def summarize(records):
    summary={field:dict(Counter(x.get(field,'unknown') for x in records)) for field in ('date_status','title_translation_status','abstract_status','abstract_review_status','title_review_status','fulltext_status','fulltext_translation_status','fulltext_review_status')}
    summary['license_eligibility']=dict(Counter(x['license']['eligibility'] for x in records))
    summary['records']=len(records)
    summary['downloaded_license_eligibility']=dict(Counter(x['license']['eligibility'] for x in records if x['fulltext_status']=='downloaded'))
    summary['fetch_error_reasons']=dict(Counter(str(x.get('fetch',{}).get('http_status') or x.get('fetch',{}).get('error','unknown')) for x in records if x['fulltext_status']=='fetch_error'))
    summary['body_paragraphs']=sum(x.get('body_paragraph_count',0) for x in records)
    summary['body_words']=sum(x.get('body_word_count',0) for x in records)
    summary['translated_paragraphs']=sum(x.get('translated_paragraph_count',0) for x in records)
    summary['formal_release_ready']=False
    return summary

def save_manifest(records):
    manifest={'schema_version':1,'frozen_at':read(OUT/'manifest.json',{}).get('frozen_at',today()),'updated_at':today(),
              'source_inventory':'_lib/lib.json','release_policy':'Translate and review all titles, abstracts, and eligible open fulltexts before formal release; retain date-pending records separately.',
              'review_policy':'Existing translations are unreviewed drafts; source alignment does not establish translation quality.',
              'summary':summarize(records),'records':records}
    write(OUT/'manifest.json',manifest)
    pending=[{'key':x['key'],'pmid':x['pmid'],'doi':x['doi'],'title':x['title'],'source_url':x['fulltext_url'],'license':x['license'],'fulltext_status':x['fulltext_status']} for x in records if x['license']['eligibility'] in ('license_unknown','license_conflict','permission_required_nd','eligible_noncommercial')]
    write(OUT/'license-decisions.json',{'updated_at':today(),'records':pending})
    return manifest

def fetch_one(record, refresh=False):
    record=dict(record); pmcid=record['pmcid'];path=OUT/'sources'/f'{pmcid}.xml';header_path=OUT/'sources'/f'{pmcid}.source.json'
    endpoint=f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML'
    try:
        if refresh or not path.exists():
            for attempt in range(2):
                try:
                    req=urllib.request.Request(endpoint,headers={'User-Agent':'HELIX-Research-Publication/1.0','Accept':'application/xml'})
                    with urllib.request.urlopen(req,timeout=20) as response:
                        content=response.read(); headers={'retrieved_at':today(),'url':endpoint,'status':response.status,'etag':response.headers.get('ETag'),'last_modified':response.headers.get('Last-Modified'),'content_type':response.headers.get('Content-Type')}
                    normalize_jats(content,record['key'],record['fulltext_url'])
                    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content);write(header_path,headers)
                    break
                except urllib.error.HTTPError as exc:
                    if exc.code in (429,502,503,504) and attempt<1:time.sleep(2*(attempt+1));continue
                    raise
                except (TimeoutError,urllib.error.URLError):
                    if attempt<1:time.sleep(attempt+1);continue
                    raise
        document=normalize_jats(path.read_bytes(),record['key'],record['fulltext_url'])
        doc_path=OUT/'documents'/f'{record["key"]}.json'
        if doc_path.exists():merge_translations(document,read(doc_path))
        document.update({'author_string':record.get('authors',''),'journal':record.get('journal',''),'year':record.get('year',''),'pmid':record['pmid'],'pmcid':pmcid,'doi':record['doi'],'source':read(header_path,{}),'source_xml':str(path.relative_to(ROOT)).replace('\\','/')})
        paragraphs=[p for s in document['sections'] for p in s['paragraphs']]
        if not any(p['zh'] for p in paragraphs):document['translation_status']='missing'
        elif not all(p['zh'] for p in paragraphs):document['translation_status']='partial_draft'
        elif document['translation_status']=='missing':document['translation_status']='draft'
        document['license']['evidence']='Official JATS article permissions'
        write(doc_path,document)
        eligibility=document['license']['eligibility']
        record.update({'license':document['license'],'fulltext_status':'downloaded' if document['body_available'] and paragraphs else 'downloaded_without_body','document_path':str(doc_path.relative_to(ROOT)).replace('\\','/'),'source_xml':document['source_xml'],'fetch':document['source'],'body_paragraph_count':len(paragraphs),'body_word_count':sum(len(p['en'].split()) for p in paragraphs),'table_count':len(document['tables']),'figure_count':len(document['figures']),'formula_count':len(document['formulas']),'reference_count':len(document['references']),'translated_paragraph_count':sum(bool(p['zh']) for p in paragraphs),'fulltext_translation_status':document['translation_status'],'fulltext_review_status':document['review_status']})
    except Exception as exc:
        record['fulltext_status']='not_available_via_epmc' if isinstance(exc,urllib.error.HTTPError) and exc.code in (404,403) else 'fetch_error'
        record['fetch']={'attempted_at':today(),'url':endpoint,'error':str(exc),'http_status':getattr(exc,'code',None)}
    return record

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fetch',action='store_true');parser.add_argument('--normalize',action='store_true');parser.add_argument('--eligible-only',action='store_true');parser.add_argument('--limit',type=int);parser.add_argument('--workers',type=int,default=6);parser.add_argument('--retry-errors',action='store_true');parser.add_argument('--refresh',action='store_true');args=parser.parse_args()
    records=inventory();save_manifest(records);print(json.dumps(summarize(records),ensure_ascii=False),flush=True)
    if args.fetch or args.normalize:
        indexed={x['key']:i for i,x in enumerate(records)}
        candidates=[x for x in records if x.get('pmcid') and (args.refresh or x['fulltext_status']=='pending_fetch' or (args.retry_errors and x['fulltext_status']=='fetch_error'))]
        if args.normalize:candidates=[x for x in records if x.get('pmcid') and (OUT/'sources'/f'{x["pmcid"]}.xml').exists()]
        candidates.sort(key=lambda x: (x['license']['eligibility'] not in ('eligible','eligible_noncommercial'), not x['is_open_access_metadata']))
        if args.eligible_only:candidates=[x for x in candidates if x['license']['eligibility'] in ('eligible','eligible_noncommercial')]
        if args.limit:candidates=candidates[:args.limit]
        print(f'Fetching {len(candidates)} official fulltexts',flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures=[pool.submit(fetch_one,x,args.refresh) for x in candidates]
            for count,future in enumerate(concurrent.futures.as_completed(futures),1):
                record=future.result();records[indexed[record['key']]]=record
                if count%25==0 or count==len(candidates):
                    save_manifest(records);print(f'{count}/{len(candidates)} '+json.dumps(dict(Counter(x['fulltext_status'] for x in records))),flush=True)
        save_manifest(records)
    print(json.dumps(summarize(records),ensure_ascii=False),flush=True)
if __name__=='__main__':main()

