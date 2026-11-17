"""Build Pages assets, including the function-protected research corpus."""
import argparse
import json
import mimetypes
from pathlib import Path
import shutil
import sys
import re
import zlib
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'_tools'))
from build_release import build

PART_BYTES=20*1024*1024


def package_private_assets(output, written):
    private_root=output/'__private_assets'
    if private_root.exists():shutil.rmtree(private_root)
    private_root.mkdir(parents=True)
    objects={}
    for item in written:
        source=Path(item['path']);size=source.stat().st_size
        parts=[];part_sizes=[]
        with source.open('rb') as stream:
            for index in range(max(1,(size+PART_BYTES-1)//PART_BYTES)):
                relative=item['key']+(f'.part-{index:04}' if size>PART_BYTES else '')
                target=private_root/relative;target.parent.mkdir(parents=True,exist_ok=True)
                data=stream.read(PART_BYTES);target.write_bytes(data)
                parts.append('/__private_assets/'+relative);part_sizes.append(len(data))
        content_type={'.js':'text/javascript','.json':'application/json'}.get(source.suffix) or mimetypes.guess_type(source.name)[0] or 'application/octet-stream'
        objects[item['key']]={'parts':parts,'partBytes':part_sizes,'bytes':size,'contentType':content_type}
    manifest={'version':1,'objects':objects}
    (private_root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return manifest


def export(output,objects):
    output=output.resolve();objects=objects.resolve()
    output.mkdir(parents=True,exist_ok=True);objects.mkdir(parents=True,exist_ok=True)
    for name in ('index.html','intro.html','admin.html','_redirects'):
        (output/name).unlink(missing_ok=True)
    build()
    written=[]
    def private(key,value=None,source=None):
        target=objects/key;target.parent.mkdir(parents=True,exist_ok=True)
        if source:shutil.copy2(source,target)
        else:target.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        written.append({'key':key,'path':str(target),'bytes':target.stat().st_size})
    def read(path):return json.loads((ROOT/path).read_text(encoding='utf-8-sig'))
    library=read('_lib/lib.json');content=read('data/reader-content.json');audit=read('data/literature-audit/index.json')
    version=datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    (ROOT/'cloud/build-version.js').write_text("export const BUILD_VERSION="+json.dumps(version)+";\n",encoding='utf-8')
    corpus_version=format(zlib.crc32(json.dumps({'library':library,'content':content,'audit':audit,'focus':read('_lib/focus.json')},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()),'08x')
    by_key={r['key']:r for r in audit['records']}
    for d in library['docs']:
        a=by_key.get(d['key'],{})
        d.update(audit_status=a.get('metadata_status'),doi_status=a.get('doi_status'),publisher_url=a.get('publisher_url'),publication_notice=a.get('notices',{}).get('status'),article_notices=a.get('notices'))
    private('runtime/catalog.json',{'docs':library['docs'],**content,'focus':read('_lib/focus.json'),
        'verify':{k:{'source':'Europe PMC','checked_on':v.get('checked_at','')} for k,v in by_key.items()},
        'sources':read('data/science-sources.json')['sources']})
    private('runtime/reading-extras.json',{'focus':read('_lib/focus.json'),'verify':{k:{'source':'Europe PMC','checked_on':v.get('checked_at','')} for k,v in by_key.items()},'sources':read('data/science-sources.json')['sources']})
    from seed_literature_v25 import build as seed_literature
    seed_literature()
    from build_public_library_v28 import build as build_public_library
    public_output=ROOT/'scratch/public-library-v28'
    build_public_library(output=public_output)
    for file in public_output.rglob('*'):
        if file.is_file() and file.name!='build-report.json':private('runtime/public-library/'+file.relative_to(public_output).as_posix(),source=file)
    identifiers={}
    for doc in library['docs']:
        values=list(dict.fromkeys(str(doc[k]) for k in ('key','pmid','doi') if doc.get(k)))
        for identifier in values:identifiers[identifier]=values
    private('runtime/identifiers.json',identifiers)
    private('runtime/library-index.json',{'version':corpus_version,'docs':[{**d,'has_abstract':bool(content['abstracts'].get(d['key'])),'has_zh':bool(content['translations'].get(d['key']))} for d in library['docs']]})
    focus=read('_lib/focus.json')
    for page,start in enumerate(range(0,len(library['docs']),100)):
        docs=library['docs'][start:start+100];keys={d['key'] for d in docs}
        private(f'runtime/library-pages/{page:04}.json',{'docs':docs,
            **{k:{key:value for key,value in content[k].items() if key in keys} for k in ('abstracts','translations','translation_sources')},
            'focus':{k:v for k,v in focus.items() if str(v.get('pmid') or v.get('key')) in keys},
            'verify':{key:{'source':'Europe PMC','checked_on':by_key[key].get('checked_at','')} for key in keys if key in by_key},
            'sources':read('data/science-sources.json')['sources'] if page==0 else []})
    private('runtime/library-pages/index.json',{'total':len(library['docs']),'pages':(len(library['docs'])+99)//100,'chunk_size':100,'version':corpus_version})
    private('runtime/guides/index.json',read('data/paper-guides/index.json'))
    for file in (ROOT/'data/paper-guides').glob('*.json'):
        if file.name!='index.json':private('runtime/guides/'+file.name,source=file)
    private('runtime/audit/index.json',audit)
    for file in (ROOT/'data/literature-audit/records').glob('*.json'):private('runtime/audit/'+file.name,source=file)
    manifest=read('data/publication/manifest.json')
    private('runtime/publications/index.json',manifest)
    private('runtime/publications/manifest.json',manifest)
    private('runtime/ledger.json',{'total':len(library['docs']),'records':[{**d,'removed':False,'review':{'status':'pending','note':''}} for d in library['docs']], 'audit':read('data/audit-v9.json')})
    for file in (ROOT/'data/publication/documents').glob('*.json'):private('runtime/publications/'+file.name,source=file)
    site=(ROOT/'helix-demo.html').read_text(encoding='utf-8').replace('<script>','<script>window.ZHIJING_RUNTIME="cloud";',1)
    discovery='<meta name="description" content="知镜 Cognispect 医学研究工作台：文献检索与精读、人体三维导航、医学统计与绘图、数学建模和论文复现。"><link rel="canonical" href="https://cognispect.tech/"><meta property="og:title" content="知镜 Cognispect · 医学研究工作台"><meta property="og:description" content="从人体出发，连接文献、统计建模与可复现的研究。"><meta property="og:url" content="https://cognispect.tech/"><meta property="og:type" content="website">'
    site=re.sub(r'<title>.*?</title>','<title>知镜 Cognispect｜医学文献与研究工作台</title>',site,count=1)
    schema={'@context':'https://schema.org','@type':'WebSite','name':'知镜','alternateName':'知镜 Cognispect','url':'https://cognispect.tech/','description':'医学文献检索与精读、人体图谱、统计绘图及论文复现。','inLanguage':'zh-CN'}
    discovery+='<script type="application/ld+json">'+json.dumps(schema,ensure_ascii=False)+'</script>'
    site=site.replace('</head>',discovery+'</head>',1)
    from html import escape
    introduction='<section class="site-introduction"><h1>知镜 Cognispect｜医学文献与研究工作台</h1><p>知镜帮助医学研究者检索和精读文献、记录研究笔记，结合人体图谱、统计绘图、数学建模和影像实验探索研究问题。无需登录即可浏览公开文献；登录后可保存个人论文与笔记、参与协作审阅和申请论文共享。</p></section>'
    site=site.replace('<main id="main"></main>','<main id="main">'+introduction+'</main>')
    scripts=output/'assets/app';scripts.mkdir(parents=True,exist_ok=True)
    def external_script(match):
        name=f'app-{zlib.crc32(match[1].encode()):08x}.js'
        (scripts/name).write_text(match[1],encoding='utf-8')
        return f'<script defer src="/assets/app/{name}"></script>'
    site=re.sub(r'<script>([\s\S]*?)</script>',external_script,site)
    def external_style(match):
        name=f'app-{zlib.crc32(match[1].encode()):08x}.css';(scripts/name).write_text(match[1],encoding='utf-8')
        return f'<link rel="stylesheet" href="/assets/app/{name}">'
    site=re.sub(r'<style>([\s\S]*?)</style>',external_style,site)
    runtime_root=output/'assets/runtime';runtime_root.mkdir(parents=True,exist_ok=True)
    lazy_assets={}
    worker_path=output/'assets/public-search-worker.js';worker_path.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'_lib/public_search_worker.js',worker_path)
    lazy_assets['searchWorker']='/assets/public-search-worker.js?v=28'
    for key,source in [('atlas',ROOT/'assets/anatomy-runtime.js'),('three',ROOT/'assets/three.min.js')]:
        data=source.read_bytes();name=f'{key}-{zlib.crc32(data):08x}.js';(runtime_root/name).write_bytes(data);lazy_assets[key]='/assets/runtime/'+name
    early='<script>window.ZHIJING_ASSETS='+json.dumps(lazy_assets,separators=(',',':'))+""";if(!new URLSearchParams(location.search).has('preview')){const v=localStorage.getItem('zhijing.library.version');window.ZHIJING_BOOTSTRAP=fetch('/api/bootstrap'+(v?'?version='+encodeURIComponent(v):''),{priority:'high'}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error||'连接未完成');return b;});window.ZHIJING_BOOTSTRAP.catch(()=>{});}</script>"""
    preload=''.join('<link rel="preload" as="script" fetchpriority="high" href="'+src+'">' for src in re.findall(r'<script defer src="([^"]+)"',site))
    site=site.replace('<head>','<head>'+early+preload,1)
    site=site.replace('</body>',"<script>if('serviceWorker'in navigator&&!new URLSearchParams(location.search).has('preview'))addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));</script></body>",1)
    (output/'index.html').write_text(site,encoding='utf-8')
    entry_pages={'main':site}
    for name in ('intro.html','admin.html','ATTRIBUTION.md'):
        text=(ROOT/name).read_text(encoding='utf-8')
        if name.endswith('.html'):text=text.replace('</head>','<script>window.ZHIJING_RUNTIME="cloud";</script></head>',1)
        if name=='intro.html':
            text=text.replace('</head>',discovery+'</head>',1).replace('<p>正在准备人体导览…</p>','<h1>知镜 Cognispect · 医学研究工作台</h1><p>文献检索与精读、人体三维导航、医学统计与绘图、数学建模和论文复现。</p><p>正在准备人体导览…</p>',1)
        if name=='admin.html':text=text.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>',1)
        if name.endswith('.html'):entry_pages[Path(name).stem]=text
        else:(output/name).write_text(text,encoding='utf-8')
    for file in (ROOT/'assets').rglob('*'):
        if not file.is_file():continue
        rel=file.relative_to(ROOT).as_posix()
        if rel.startswith('assets/anatomy/'):
            private(rel,source=file);continue
        if file.stat().st_size>PART_BYTES:raise ValueError('Pages asset too large: '+rel)
        target=output/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target)
    package_private_assets(output,written)
    entry_root=output/'__private_assets/site';entry_root.mkdir(parents=True,exist_ok=True)
    for name,text in entry_pages.items():(entry_root/(name+'.bin')).write_text(text,encoding='utf-8')
    shell_version=format(zlib.crc32(site.encode()),'08x')
    (output/'sw.js').write_text((ROOT/'assets/sw.js').read_text(encoding='utf-8').replace('__ZHIJING_SHELL_VERSION__',shell_version),encoding='utf-8')
    (output/'_routes.json').write_text(json.dumps({'version':1,'include':['/intro','/intro/','/intro.html','/admin','/admin/','/admin.html','/api/*','/papers/*','/sitemap.xml','/content/*','/assets/anatomy/*','/__private_assets','/__private_assets/*'],'exclude':[]}),encoding='utf-8')
    discovery_config=read('data/search-discovery.json')
    indexnow_key=discovery_config['indexnow_key']
    (output/(indexnow_key+'.txt')).write_text(indexnow_key,encoding='utf-8')
    (output/'robots.txt').write_text('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /content/\nDisallow: /__private_assets/\nSitemap: https://cognispect.tech/sitemap.xml\n',encoding='utf-8')
    (output/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://cognispect.tech/</loc></url></urlset>\n',encoding='utf-8')
    (output/'_headers').write_text('/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n/assets/app/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/anatomy-runtime.js\n  Cache-Control: no-cache\n/assets/compute/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/compute/zhijing-python.zip\n  Cache-Control: no-cache\n/assets/compute/runtime.json\n  Cache-Control: no-cache\n/assets/browser-compute-worker.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n',encoding='utf-8')
    with (output/'_headers').open('a',encoding='utf-8') as headers:
        headers.write('/assets/runtime/*\n  Cache-Control: public, max-age=31536000, immutable\n/sw.js\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n')
        headers.write('/assets/public-search-worker.js\n  Cache-Control: no-cache\n/demo/\n  X-Robots-Tag: noindex, nofollow\n')
    from build_demo_v28 import build_demo
    build_demo(output,export_local=True)
    page_files=[file for file in output.rglob('*') if file.is_file() and '_worker.js' not in file.relative_to(output).parts]
    if len(page_files)>=20_000:raise ValueError('Pages file count must remain below 20,000')
    result={'site':str(output),'objects':str(objects),'static_objects':len(written),'static_bytes':sum(r['bytes'] for r in written),'pages_files':len(page_files),'files':written}
    (objects/'upload-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return {k:v for k,v in result.items() if k!='files'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--site',type=Path,default=ROOT/'scratch/cloud-site')
    p.add_argument('--objects',type=Path,default=ROOT/'scratch/cloud-objects')
    args=p.parse_args();print(json.dumps(export(args.site,args.objects),ensure_ascii=False,indent=2))
