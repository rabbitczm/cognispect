"""Import public catalog SQL in resumable batches using the existing Wrangler login."""
import json
from pathlib import Path
import subprocess
import time
ROOT=Path(__file__).resolve().parents[1]
WRANGLER=ROOT.parents[1]/'tools/helix-wrangler/node_modules/wrangler/bin/wrangler.js'
folder=ROOT/'scratch/literature-v25/import';folder.mkdir(parents=True,exist_ok=True)
lines=(ROOT/'scratch/literature-v25/seed.sql').read_text(encoding='utf-8').splitlines()
results=json.loads((folder/'results.json').read_text(encoding='utf-8')) if (folder/'results.json').exists() else []
for i in range(0,len(lines),1000):
    part=folder/f'{i//1000:03}.sql';source='\n'.join(lines[i:i+1000])
    if part.exists() and part.read_text(encoding='utf-8')==source and any(r['part']==part.name for r in results):
        print(part.name+': already imported',flush=True);continue
    part.write_text(source,encoding='utf-8')
    log=part.with_suffix('.log')
    for attempt in range(6):
        run=subprocess.run(['node',str(WRANGLER),'d1','execute','cognispect','--remote','--config','cloud/wrangler.toml','--file',str(part),'--json'],cwd=ROOT,capture_output=True,encoding='utf-8',errors='replace')
        log.write_text(run.stdout+'\n'+run.stderr,encoding='utf-8')
        if run.returncode==0:
            start=run.stdout.find('[\n');value=json.loads(run.stdout[start:]);meta=value[0]['meta'];results.append({'part':part.name,**meta});print(json.dumps({'part':part.name,'written':meta['rows_written'],'size':meta['size_after']}),flush=True);break
        print(f'{part.name}: retry {attempt+1}',flush=True)
        if attempt==5:raise RuntimeError('Import incomplete; see '+str(log))
        time.sleep(1)
    (folder/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps({'parts':len(results),'rows_written':sum(r['rows_written'] for r in results),'size':results[-1]['size_after']}),flush=True)
