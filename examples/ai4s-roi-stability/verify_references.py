from pathlib import Path
import subprocess,json,datetime
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'references';OUT.mkdir(exist_ok=True)
dois=['10.1148/radiol.2020191145','10.1016/j.ijrobp.2018.05.053','10.1038/s41467-022-30695-9','10.1158/0008-5472.CAN-17-0339','10.1038/srep45639']
verified=[]
for i,doi in enumerate(dois,1):
    url='https://api.crossref.org/works/'+doi
    target=OUT/f'crossref-{i}.json'
    res=subprocess.run(['curl.exe','-sS','-f','-L','--max-time','30',url,'-o',str(target)],capture_output=True,text=True)
    if res.returncode: print(doi,res.stderr);continue
    m=json.loads(target.read_text(encoding='utf-8'))['message']
    row={'doi':m['DOI'],'title':m.get('title',[''])[0],'authors':'; '.join(' '.join([a.get('given',''),a.get('family','')]).strip() for a in m.get('author',[])),'journal':m.get('container-title',[''])[0],'year':m.get('issued',{}).get('date-parts',[['']])[0][0],'volume':m.get('volume'),'issue':m.get('issue'),'pages':m.get('page'),'article_number':m.get('article-number'),'source_url':url,'doi_url':m.get('URL'),'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    verified.append(row); print(json.dumps(row,ensure_ascii=False))
(OUT/'verified_references.json').write_text(json.dumps(verified,ensure_ascii=False,indent=2),encoding='utf-8')
