"""Build the approved public competition snapshot and its independent local copy."""
import argparse
import json
from pathlib import Path
import re
import shutil
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
WORKSPACE=Path('D:/workspace/codex_list')
OUT=WORKSPACE/'output/zhijing-v28'

def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def build_demo(site,export_local=True):
    site=Path(site)
    snapshot=read(OUT/'backup/public-state.json')
    settings=next(iter(snapshot[0]['results']),None)
    if not settings:raise ValueError('A verified published-state snapshot is required for the demo.')
    published=json.loads(settings['published'])
    hidden={str(r['item_key']) for r in snapshot[1]['results'] if not r['visible']}
    removed={str(r['key']) for r in snapshot[2]['results'] if r['removed']}
    records=read(ROOT/'scratch/literature-v25/records.json')
    allowed=[d for d in records if not d.get('date_pending') and not any(str(d.get(k,'')) in hidden|removed for k in ['key','pmid','doi']) and d.get('abstract') and (d.get('pmid') or d.get('doi'))]
    groups=[r'diabetic nephropathy|diabetic kidney',r'diabetic retinopathy',r'essential hypertension|systemic hypertension',r'pulmonary arterial hypertension',r'lung cancer|pulmonary nodule',r'breast cancer|uterus|ovarian',r'liver|hepatic',r'stroke|brain|glioma',r'heart failure|coronary',r'kidney|renal',r'radiomic|reproducib|statistics']
    chosen={}
    for pattern in groups:
        matches=sorted((d for d in allowed if re.search(pattern,d['title']+' '+d['abstract'],re.I)),key=lambda d:(bool(d.get('zh')),d.get('level',1),d.get('cited',0)),reverse=True)
        for d in matches[:7]:chosen[str(d['key'])]=d
    for d in sorted(allowed,key=lambda d:(d.get('level',1),d.get('cited',0)),reverse=True):
        if len(chosen)>=88:break
        chosen[str(d['key'])]=d
    docs=sorted(chosen.values(),key=lambda d:(str(d.get('firstdate') or d.get('year','')),str(d['key'])),reverse=True)
    if len(docs)<40:raise ValueError('The competition snapshot needs at least forty public sample papers.')
    quality=read(WORKSPACE/'output/zhijing-v26/medical-quality.json')
    examples=[dict(r,label={'kidney':'糖尿病肾病与视网膜病变','systemic':'原发性高血压与肺动脉高压','hr-hazard':'风险比语境','hr-heart':'心率语境'}.get(r['id'],r['id'])) for r in quality['results'] if r.get('passed')][:8]
    demo=site/'demo';demo.mkdir(parents=True,exist_ok=True)
    for name in ['adapter.js','demo.css']:shutil.copy2(ROOT/'data/demo-v28'/name,demo/name)
    data={'version':'competition-demo-v28','reviewedOn':datetime.now(timezone.utc).date().isoformat(),'site':published,'docs':docs,'examples':examples}
    (demo/'library.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    html=(site/'__private_assets/site/main.bin').read_text(encoding='utf-8')
    html=html.replace('<head>','<head><script src="/demo/adapter.js"></script><link rel="stylesheet" href="/demo/demo.css"><meta name="robots" content="noindex,nofollow">',1)
    html=re.sub(r'<title>.*?</title>','<title>知镜｜比赛演示版</title>',html,count=1)
    html=html.replace("if('serviceWorker'in navigator&&!new URLSearchParams(location.search).has('preview'))","if(false)")
    (demo/'index.html').write_text(html,encoding='utf-8')
    anatomy=ROOT/'assets/anatomy'
    legacy=[p.name for p in anatomy.iterdir() if p.is_file() and p.name not in {'manifest-v22.json','intro.js'}]
    for name in legacy:(demo/'assets/anatomy'/name).unlink(missing_ok=True)
    for file in anatomy.rglob('*'):
        if file.is_file():
            if file.parent==anatomy and file.name in legacy:continue
            target=demo/'assets/anatomy'/file.relative_to(anatomy);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target)
    report={'papers':len(docs),'examples':len(examples),'publicStateVerified':True,'databaseRequired':False,'liveAiRequired':False,'models':'Original male BodyParts3D and female anatomy meshes; v27 rendering','local':None}
    if export_local:
        local=OUT/'local-demo';local.mkdir(parents=True,exist_ok=True)
        shutil.copytree(demo,local/'demo',dirs_exist_ok=True)
        for name in legacy:(local/'demo/assets/anatomy'/name).unlink(missing_ok=True)
        shutil.copytree(site/'assets',local/'assets',dirs_exist_ok=True)
        runtime=local/'runtime';runtime.mkdir(exist_ok=True)
        shutil.copy2(shutil.which('node'),runtime/'node.exe')
        shutil.copy2(ROOT/'data/demo-v28/node-LICENSE.txt',runtime/'LICENSE.txt')
        shutil.copy2(ROOT/'data/demo-v28/server.cjs',local/'server.cjs')
        (local/'index.html').write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/demo/"><a href="/demo/">打开知镜比赛演示版</a>',encoding='utf-8')
        (local/'启动知镜演示.ps1').write_text("$ErrorActionPreference='Stop'\n$env:TEMP=Join-Path $PSScriptRoot 'temp'\n$env:TMP=$env:TEMP\nNew-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null\nSet-Location -LiteralPath $PSScriptRoot\n& (Join-Path $PSScriptRoot 'runtime/node.exe') (Join-Path $PSScriptRoot 'server.cjs')\n",encoding='utf-8-sig')
        (local/'打开演示.cmd').write_text('@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动知镜演示.ps1"\r\n',encoding='utf-8')
        (local/'使用说明.md').write_text('# 知镜比赛演示版\n\n双击“打开演示.cmd”，浏览器进入 http://127.0.0.1:8778/demo/ 。所有页面、模型、公开影像和计算依赖已在本目录，可断开外网使用，无需另装 Python 或 Node.js。保留启动窗口。整个目录可以复制到其他 Windows 电脑使用。\n\n本包包含 '+str(len(docs))+' 篇明确公开的固定文献、原男女图谱、公开影像 ROI、统计与数学本地计算。AI 示例来自此前实际模型验收并明确标注，不会发起实时 AI 请求。\n\n演示版不连接正式账号、上传、审批或云端笔记；这些操作请返回 https://cognispect.tech/ 。本包不包含真实账号、私人文件、会话令牌或服务密钥。\n\n随包 Node.js 运行时的许可保存在 runtime/LICENSE.txt；模型与影像来源许可保留在原始资源中。\n',encoding='utf-8')
        report['local']=str(local)
    files=[p for p in demo.rglob('*') if p.is_file()]
    report.update(publicFiles=len(files),publicBytes=sum(p.stat().st_size for p in files),largestPublicAsset=max(p.stat().st_size for p in files))
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'demo-build.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--site',type=Path,default=ROOT/'scratch/cloud-site');p.add_argument('--no-local',action='store_true');args=p.parse_args();print(json.dumps(build_demo(args.site,not args.no_local),ensure_ascii=False))
