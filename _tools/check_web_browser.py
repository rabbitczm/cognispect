"""Exercise website signup and private workspaces using an isolated local mail outbox."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--serve',action='store_true');args=parser.parse_args()
    if args.serve:
        import uvicorn
        from web_app import create_app
        def mailbox(message):
            with Path(os.environ['HELIX_TEST_OUTBOX']).open('a',encoding='utf-8') as stream:stream.write(json.dumps(message,ensure_ascii=False)+'\n')
        app=create_app(os.environ['HELIX_DATA_DIR'],os.environ['HELIX_URL'],mailbox)
        app.state.store.create_staff('admin-review@example.org','review-password-17',role='admin')
        uvicorn.run(app,host='127.0.0.1',port=8093,log_level='warning',access_log=False)
        return
    folder=ROOT/'scratch/tmp';folder.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=folder) as temporary:
        directory=Path(temporary);env={**os.environ,'HELIX_DATA_DIR':str(directory/'data'),'HELIX_TEST_OUTBOX':str(directory/'mail.jsonl'),'HELIX_URL':'http://127.0.0.1:8093','TEMP':str(folder),'TMP':str(folder),'PYTHONDONTWRITEBYTECODE':'1','PYTHONIOENCODING':'utf-8'}
        log=(directory/'server.log').open('w',encoding='utf-8')
        process=subprocess.Popen([sys.executable,__file__,'--serve'],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            for _ in range(60):
                try:
                    urllib.request.urlopen(env['HELIX_URL']+'/api/health',timeout=1).close();break
                except OSError:time.sleep(.25)
            result=subprocess.run(['node',str(ROOT/'_tools/test_web_users.js')],cwd=ROOT,env=env)
            if result.returncode:log.flush();print((directory/'server.log').read_text(encoding='utf-8'))
            raise SystemExit(result.returncode)
        finally:
            process.terminate();process.wait(timeout=15);log.close()

if __name__=='__main__':main()
