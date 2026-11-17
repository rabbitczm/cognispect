"""Translate frozen scholarly sources using an independent contextual DeepL account."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
import urllib.request
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'_tools'))
from prepare_publication import read, write, OUT, inventory, save_manifest

def payload(texts,context=''):
    return json.dumps({'text':texts,'context':context,'source_lang':'EN','target_lang':'ZH','preserve_formatting':True},ensure_ascii=False).encode('utf8')

class DeepLTranslator:
    def __init__(self):
        self.key=os.environ.get('HELIX_TRANSLATION_KEY','')
        if not self.key:raise ValueError('Set HELIX_TRANSLATION_KEY for the independent DeepL translation account.')
        self.endpoint=('https://api-free.deepl.com' if self.key.endswith(':fx') else 'https://api.deepl.com')+'/v2/translate'
    def translate(self,texts,context):
        body=payload(texts,context)
        while len(body)>128*1024:
            if len(texts)>1:
                mid=len(texts)//2
                return self.translate(texts[:mid],context)+self.translate(texts[mid:],context)
            if not context:raise ValueError('A source item exceeds the DeepL 128 KiB request limit.')
            context=context[:len(context)*3//4];body=payload(texts,context)
        request=urllib.request.Request(self.endpoint,data=body,headers={'Authorization':'DeepL-Auth-Key '+self.key,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=90) as response:result=json.loads(response.read())
        return [item['text'] for item in result['translations']]

def batches(jobs):
    batch=[]
    for job in jobs:
        candidate=batch+[job]
        if batch and (job['context']!=batch[0]['context'] or len(candidate)>50 or len(payload([j['en'] for j in candidate],candidate[0]['context']))>128*1024):
            yield batch;batch=[job]
        else:batch=candidate
    if batch:yield batch

def source_jobs(document):
    jobs=[];title=document['title'];sections=document['sections']
    intro=next((' '.join(p['en'] for p in section['paragraphs']) for section in sections if section['paragraphs']),'')
    def pair(obj,en_name,zh_name,kind,context):
        en=obj.get(en_name,'')
        if en and (not obj.get(zh_name) or obj.get('translation_status')=='source_changed'):
            jobs.append({'en':en,'object':obj,'field':zh_name,'kind':kind,'context':context})
    pair(document,'title','title_zh','title',intro)
    for i,section in enumerate(sections):
        surrounding=sections[max(0,i-1):i+2]
        context=title+'\n'+'\n'.join(s['title']+'\n'+'\n'.join(p['en'] for p in s['paragraphs']) for s in surrounding)
        pair(section,'title','title_zh','heading',context)
        for paragraph in section['paragraphs']:pair(paragraph,'en','zh','paragraph',context)
    def item_context(item):
        mentions=[p['en'] for s in sections for p in s['paragraphs'] if item['id'] in p.get('reference_ids',[])]
        return title+'\n'+item.get('caption','')+'\n'+'\n'.join(mentions or [intro])
    for table in document['tables']:
        context=item_context(table)+'\n'+'\n'.join(' | '.join(row) for row in table['rows'])
        pair(table,'caption','caption_zh','caption',context);pair(table,'footnotes','footnotes_zh','footnotes',context)
        zhrows=table.setdefault('rows_zh',[['' for cell in row] for row in table['rows']])
        for ri,row in enumerate(table['rows']):
            for ci,cell in enumerate(row):
                if cell and any(c.isalpha() for c in cell) and not zhrows[ri][ci]:jobs.append({'en':cell,'object':table,'field':'rows_zh','row':ri,'col':ci,'kind':'table_cell','context':context})
                elif not zhrows[ri][ci]:zhrows[ri][ci]=cell
    for figure in document['figures']:pair(figure,'caption','caption_zh','caption',item_context(figure))
    return jobs

def apply_results(batch,translations):
    if len(batch)!=len(translations):raise ValueError('DeepL response count does not match the submitted text count.')
    for job,zh in zip(batch,translations):
        obj=job['object']
        if job['kind']=='table_cell':obj['rows_zh'][job['row']][job['col']]=zh
        else:obj[job['field']]=zh
        obj['translation_status']='machine_translated';obj['review_status']='not_reviewed'
        obj['translation_engine']='DeepL';obj['translated_at']=dt.datetime.now(dt.timezone.utc).isoformat()

def number_report():
    findings=[];compared=0
    def numbers(text):
        value=unicodedata.normalize('NFKC',text)
        value=re.sub(r'https?://\S+','',value)
        value=re.sub(r'\[(?:\d+[,;\s–-]*)+\]','',value)
        return Counter(re.findall(r'(?<![A-Za-z])\d+(?:\.\d+)?',value))
    def compare(key,location,en,zh):
        nonlocal compared
        if not zh:return
        compared+=1;left=numbers(en);right=numbers(zh)
        if left!=right:findings.append({'key':key,'location':location,'source_only':dict(left-right),'translation_only':dict(right-left),'en':en,'zh':zh,'status':'needs_contextual_review'})
    for key,record in read(OUT/'translation-drafts.json',{'records':{}})['records'].items():
        for field in ('title','abstract'):
            pair=record.get(field,{})
            compare(key,field,pair.get('en',''),pair.get('zh',''))
    source_findings=[]
    for path in (OUT/'documents').glob('*.json'):
        doc=read(path);key=doc['key'];compare(key,'title',doc['title'],doc.get('title_zh',''))
        for section in doc['sections']:
            compare(key,section['id']+'/heading',section['title'],section.get('title_zh',''))
            for paragraph in section['paragraphs']:compare(key,paragraph['id'],paragraph['en'],paragraph.get('zh',''))
        for name in ('tables','figures'):
            for item in doc[name]:
                compare(key,item['id']+'/caption',item['caption'],item.get('caption_zh',''))
                if name=='tables':
                    compare(key,item['id']+'/footnotes',item.get('footnotes',''),item.get('footnotes_zh',''))
                    for ri,row in enumerate(item.get('rows_zh',[])):
                        for ci,cell in enumerate(row):compare(key,f'{item["id"]}/row{ri+1}/cell{ci+1}',item['rows'][ri][ci],cell)
        source_findings.extend(dict(finding,key=key) for finding in doc.get('review',{}).get('findings',[]))
    result={'updated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'compared_text_pairs':compared,'numeric_difference_count':len(findings),'findings':findings,'source_findings':source_findings,'interpretation':'Numeric differences identify passages to inspect; citation numbering, spelled-out numbers, units, and formatting can explain differences. No automatic translation rejection or publication decision.'}
    write(OUT/'text-number-check.json',result);return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--scope',choices=['all','metadata','fulltext'],default='all');parser.add_argument('--plan',action='store_true');parser.add_argument('--check-numbers',action='store_true');parser.add_argument('--limit',type=int);args=parser.parse_args()
    if args.check_numbers:
        report=number_report();print(json.dumps({k:report[k] for k in ('compared_text_pairs','numeric_difference_count')})+' source_findings='+str(len(report['source_findings'])));return
    records=read(OUT/'manifest.json')['records'];active=[r for r in records if r['date_status']!='pending']
    if args.limit:active=active[:args.limit]
    drafts=read(OUT/'translation-drafts.json',{'schema_version':1,'records':{}});reader=read(ROOT/'data/reader-content.json');progress=read(OUT/'translation-progress.json',{})
    def units():
        if args.scope in ('all','metadata'):
            for record in active:
                jobs=[];target=drafts['records'].setdefault(record['key'],{});abstract=reader['abstracts'].get(record['key'],'');context=record['title']+'\n'+abstract
                for name,en in [('title',record['title']),('abstract',abstract)]:
                    existing=target.get(name,{})
                    if en and (existing.get('en')!=en or not existing.get('zh')):
                        target[name]={'en':en,'zh':'','translation_status':'missing','review_status':'not_reviewed'}
                        jobs.append({'en':en,'object':target[name],'field':'zh','kind':name,'context':context})
                yield 'metadata:'+record['key'],jobs,lambda:write(OUT/'translation-drafts.json',drafts)
        if args.scope in ('all','fulltext'):
            for record in active:
                if record['license']['eligibility'] not in ('eligible','eligible_noncommercial') or record['fulltext_status']!='downloaded' or not record.get('document_path'):continue
                path=ROOT/record['document_path'];document=read(path);jobs=source_jobs(document)
                def checkpoint(path=path,document=document):
                    paragraphs=[p for section in document['sections'] for p in section['paragraphs']]
                    document['translation_status']='machine_translated' if paragraphs and all(p.get('zh') for p in paragraphs) and not source_jobs(document) else 'partial_draft'
                    document['review_status']='not_reviewed';document['publication_status']='draft';document['public']=False;write(path,document)
                    progress[document['key']]={'fulltext_translation_status':document['translation_status'],'fulltext_review_status':'not_reviewed','translated_paragraph_count':sum(bool(p.get('zh')) for p in paragraphs)};write(OUT/'translation-progress.json',progress)
                yield record['key'],jobs,checkpoint
    if args.plan:
        counts={'texts':0,'source_characters':0,'documents':0,'scope':args.scope,'date_pending_excluded':sum(r['date_status']=='pending' for r in records),'translation_engine':'DeepL','context':'per article and section, with adjacent source paragraphs','plan_only':True}
        for key,jobs,_ in units():
            counts['texts']+=len(jobs);counts['source_characters']+=sum(len(j['en']) for j in jobs);counts['documents']+=not key.startswith('metadata:')
        print(json.dumps(counts,ensure_ascii=False),flush=True);return
    engine=DeepLTranslator();completed=0
    for key,jobs,checkpoint in units():
        for batch in batches(jobs):
            translated=engine.translate([j['en'] for j in batch],batch[0]['context'])
            for offset in range(0,len(batch),50):
                apply_results(batch[offset:offset+50],translated[offset:offset+50]);completed+=min(50,len(batch)-offset)
                checkpoint();print(f'{key}: stored {completed} translated texts; awaiting source comparison review.',flush=True)
    save_manifest(inventory());number_report()
if __name__=='__main__':main()
