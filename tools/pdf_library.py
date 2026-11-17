import csv,io,json,re,secrets,urllib.request,urllib.parse,urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime,timezone

class PdfLibrary:
 def __init__(self,directory):
  self.root=Path(directory);self.root.mkdir(parents=True,exist_ok=True)
 def list(self):
  return sorted([self.get(p.stem,summary=True) for p in self.root.glob('*.json')],key=lambda d:d['created'],reverse=True)
 def get(self,key,summary=False):
  data=json.loads((self.root/(key+'.json')).read_text(encoding='utf-8'))
  if summary:return {k:v for k,v in data.items() if k not in {'pages','tables','text'}}
  return data
 def file(self,key):
  if not re.fullmatch(r'[a-f0-9]{24}',key):raise ValueError('PDF 标识无效')
  return self.root/(key+'.pdf')
 def add(self,raw,name,source=None):
  import pdfplumber
  if not raw.startswith(b'%PDF-'):raise ValueError('文件内容不是 PDF')
  key=secrets.token_hex(12);pages=[];tables=[]
  with pdfplumber.open(io.BytesIO(raw)) as pdf:
   meta=pdf.metadata or {}
   for i,page in enumerate(pdf.pages):
    text=page.extract_text(layout=False) or ''
    pages.append({'number':i+1,'text':text,'width':page.width,'height':page.height})
    for t in page.find_tables():
     rows=[]
     for row in t.extract():
      cells=[str(c or '').strip() for c in row]
      lines=[cell.splitlines() for cell in cells]
      numeric_lengths=[len(parts) for parts in lines if len(parts)>1 and all(re.fullmatch(r'[+-]?[\d,]+(?:\.\d+)?',part.strip()) for part in parts)]
      count=max(set(numeric_lengths),key=numeric_lengths.count) if numeric_lengths else 1
      if count>1 and numeric_lengths.count(count)>=2 and all(len(parts) in (0,1,count) for parts in lines):
       rows.extend([[parts[i].strip() if len(parts)==count else (parts[0].strip() if parts else '') for parts in lines] for i in range(count)])
      else:rows.append([cell.replace('\n',' ') for cell in cells])
     if len(rows)>1 and len(rows[0])>1:
      output=io.StringIO();csv.writer(output).writerows(rows)
      tables.append({'id':'t'+str(len(tables)),'page':i+1,'bbox':list(t.bbox),'rows':rows,'csv':output.getvalue()})
  text='\n\n'.join(p['text'] for p in pages)
  doi=re.search(r'10\.\d{4,9}/[^\s<>"\]]+',text,re.I)
  title=str(meta.get('Title') or '').strip()
  if not title or title.lower() in {'untitled','document'}:title=next((line.strip() for line in (pages[0]['text'] if pages else '').splitlines() if len(line.strip())>15),name)
  data={'id':key,'name':Path(name).name,'title':title,'author':str(meta.get('Author') or ''),'doi':doi.group().rstrip('.,;)') if doi else '',
        'pages':pages,'page_count':len(pages),'tables':tables,'table_count':len(tables),'text':text,'source':source or {},'created':datetime.now(timezone.utc).isoformat(),
        'url':'/api/pdf/file/'+key,'bytes':len(raw)}
  self.file(key).write_bytes(raw);(self.root/(key+'.json')).write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
  return data
 def remove(self,key):
  self.file(key).unlink(missing_ok=True);(self.root/(key+'.json')).unlink(missing_ok=True)

def official_record(identifier):
 identifier=str(identifier).strip()
 query=('EXT_ID:'+identifier+' AND SRC:MED') if identifier.isdigit() else 'DOI:"'+identifier.replace('https://doi.org/','').replace('"','')+'"'
 url='https://www.ebi.ac.uk/europepmc/webservices/rest/search?'+urllib.parse.urlencode({'query':query,'format':'json','resultType':'core','pageSize':1})
 with urllib.request.urlopen(url,timeout=45) as response:data=json.load(response)
 rows=data.get('resultList',{}).get('result',[])
 if not rows:raise ValueError('Europe PMC 未找到该 PMID / DOI')
 return rows[0],url

def open_pdf(library,pmid):
 for item in library.list():
  if item.get('source',{}).get('pmid')==pmid:return library.get(item['id'])
 record,record_url=official_record(pmid)
 candidates=[]
 metadata={}
 if record.get('pmcid'):
  bucket='https://pmc-oa-opendata.s3.amazonaws.com/'
  try:
   listing=bucket+'?'+urllib.parse.urlencode({'list-type':'2','prefix':'metadata/'+record['pmcid']+'.'})
   with urllib.request.urlopen(listing,timeout=20) as response:tree=ET.fromstring(response.read())
   keys=[element.text for element in tree.findall('.//{*}Key') if element.text.endswith('.json')]
   if keys:
    latest=max(keys,key=lambda key:int(key.rsplit('.',2)[1]))
    with urllib.request.urlopen(bucket+latest,timeout=20) as response:metadata=json.load(response)
    pdf=metadata.get('pdf_url')
    if pdf and str(metadata.get('pmid'))==str(pmid):
     if pdf.startswith('s3://pmc-oa-opendata/'):pdf=bucket+pdf[len('s3://pmc-oa-opendata/'):]
     candidates.append(pdf)
  except (urllib.error.URLError,TimeoutError,ValueError,KeyError):pass
 for item in record.get('fullTextUrlList',{}).get('fullTextUrl',[]):
  if item.get('documentStyle')=='pdf' and item.get('availabilityCode')=='OA':candidates.append(item.get('url'))
 if record.get('pmcid'):candidates.append('https://europepmc.org/articles/'+record['pmcid']+'?pdf=render')
 for url in dict.fromkeys(candidates):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'HELIX research reader'}),timeout=60) as response:raw=response.read()
   if raw.startswith(b'%PDF-'):
    result=library.add(raw,'PMID-'+pmid+'.pdf',{'pmid':pmid,'doi':record.get('doi',''),'url':url,'record_url':record_url,'license':metadata.get('license_code','')})
    result.update(title=re.sub('<[^>]+>',' ',record['title']),author=record.get('authorString',''),doi=record.get('doi',''))
    (library.root/(result['id']+'.json')).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    return result
  except (urllib.error.URLError,TimeoutError):continue
 return {'unavailable':True,'message':'本次未成功获取 PDF。可打开原文来源，或拖入已取得的 PDF。','source_url':'https://doi.org/'+record['doi'] if record.get('doi') else 'https://europepmc.org/article/MED/'+pmid}
