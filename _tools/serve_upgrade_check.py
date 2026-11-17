import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.web_app import create_app
import uvicorn

app=create_app(os.environ['HELIX_CHECK_DATA'],'http://127.0.0.1:8097')
if not app.state.store.users():
    app.state.store.create_staff('researcher@example.org','research-password-18',role='user')
    app.state.store.create_staff('admin@example.org','admin-password-18',role='admin')
uvicorn.run(app,host='127.0.0.1',port=8097,access_log=False)
