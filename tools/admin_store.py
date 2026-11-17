import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from contextlib import contextmanager
from pathlib import Path


class AdminStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self.file = directory / 'management.sqlite'
        self.sessions = {}
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY, username TEXT, salt TEXT, password TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS reviews (key TEXT PRIMARY KEY, status TEXT, note TEXT, updated TEXT, reviewer TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS staff (username TEXT PRIMARY KEY, salt TEXT, password TEXT, role TEXT, active INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT, expires REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS articles (key TEXT PRIMARY KEY, payload TEXT, removed INTEGER, updated TEXT, editor TEXT)')
            old=db.execute('SELECT username,salt,password FROM account WHERE id=1').fetchone()
            if old:db.execute("INSERT OR IGNORE INTO staff VALUES (?,?,?,'admin',1)",old)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.file)
        try:
            with db:
                yield db
        finally:
            db.close()

    def account(self):
        with self.connect() as db:
            return db.execute("SELECT username,salt,password FROM staff WHERE role='admin' AND active=1 LIMIT 1").fetchone()

    def identity(self, token):
        with self.connect() as db:
            row=db.execute('SELECT staff.username FROM sessions JOIN staff USING(username) WHERE token=? AND expires>? AND active=1',(token,time.time())).fetchone()
            return row[0] if row else None

    def role(self,username):
        with self.connect() as db:
            row=db.execute('SELECT role FROM staff WHERE username=? AND active=1',(username,)).fetchone()
            return row[0] if row else None

    def logout(self,token):
        with self.connect() as db:db.execute('DELETE FROM sessions WHERE token=?',(token,))

    def users(self):
        with self.connect() as db:
            return [{'username':u,'role':r,'active':bool(a)} for u,r,a in db.execute('SELECT username,role,active FROM staff ORDER BY role,username')]

    def save_user(self,username,password='',role='editor',active=True):
        username=username.strip()
        if not username or role not in {'admin','editor'}:raise ValueError('填写账号并选择角色')
        with self.connect() as db:
            old=db.execute('SELECT salt,password FROM staff WHERE username=?',(username,)).fetchone()
            if not old and not password:raise ValueError('新人员需要设置密码')
            if password:
                salt=secrets.token_hex(16)
                digest=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
            else:salt,digest=old
            db.execute('INSERT OR REPLACE INTO staff VALUES (?,?,?,?,?)',(username,salt,digest,role,int(active)))
            if password or not active:db.execute('DELETE FROM sessions WHERE username=?',(username,))

    def remove_user(self,username):
        with self.connect() as db:
            db.execute('DELETE FROM sessions WHERE username=?',(username,))
            db.execute('DELETE FROM staff WHERE username=?',(username,))

    def login(self, username, password, setup=False, remember=False):
        with self.lock:
            account = self.account()
            if setup:
                if account:
                    raise ValueError('管理员账号已创建，请登录')
                if not username.strip() or len(password) < 8:
                    raise ValueError('填写账号，并设置至少 8 位密码')
                self.save_user(username,password,'admin')
            with self.connect() as db:account=db.execute('SELECT username,salt,password FROM staff WHERE username=? AND active=1',(username.strip(),)).fetchone()
            if not account:raise ValueError('账号或密码不正确')
            digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(account[1]), n=16384, r=8, p=1).hex()
            if account[0] != username.strip() or not hmac.compare_digest(digest, account[2]):
                raise ValueError('账号或密码不正确')
            token = secrets.token_urlsafe(32)
            with self.connect() as db:db.execute('INSERT INTO sessions VALUES (?,?,?)',(token,account[0],time.time()+(7*86400 if remember else 86400)))
            return token, account[0]

    def save_article(self,article,editor):
        key=str(article.get('key') or article.get('pmid') or article.get('doi') or secrets.token_hex(8))
        if not str(article.get('title','')).strip():raise ValueError('请填写文章题名')
        library_path=Path(__file__).resolve().parents[1]/'_lib/lib.json'
        original=next((d for d in json.loads(library_path.read_text(encoding='utf-8'))['docs'] if d['key']==key),{})
        with self.connect() as db:previous=db.execute('SELECT payload FROM articles WHERE key=?',(key,)).fetchone()
        if previous:original.update(json.loads(previous[0]))
        article={**original,**article,'key':key}
        if article.get('authors'):article['authors_full']=article['authors']
        if isinstance(article.get('topics'),str):article['topics']=[x.strip() for x in article['topics'].split(',') if x.strip()]
        article.setdefault('topics',[]);article.setdefault('level',1);article.setdefault('cited',0)
        article['date_pending']=bool(article.get('date_pending')) or str(article.get('firstdate',''))>datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
        with self.connect() as db:db.execute('INSERT OR REPLACE INTO articles VALUES (?,?,0,?,?)',(key,json.dumps(article,ensure_ascii=False),datetime.now(timezone.utc).isoformat(),editor))
        return article

    def remove_article(self,key,editor):
        with self.connect() as db:
            old=db.execute('SELECT payload FROM articles WHERE key=?',(key,)).fetchone()
            db.execute('INSERT OR REPLACE INTO articles VALUES (?,?,1,?,?)',(key,old[0] if old else '{}',datetime.now(timezone.utc).isoformat(),editor))

    def catalog(self):
        with self.connect() as db:rows=db.execute('SELECT key,payload,removed FROM articles').fetchall()
        return {'upserts':[json.loads(p) for k,p,r in rows if not r],'removed':[k for k,p,r in rows if r]}

    def article(self,key,root):
        root=Path(root)
        docs=json.loads((root/'_lib/lib.json').read_text(encoding='utf-8'))['docs']
        article=next((d for d in docs if d['key']==key),{'key':key})
        content=json.loads((root/'data/reader-content.json').read_text(encoding='utf-8'))
        article.update(abstract=content['abstracts'].get(key,''),zh=content['translations'].get(key,''),translation_source=content['translation_sources'].get(key,''))
        with self.connect() as db:row=db.execute('SELECT payload FROM articles WHERE key=?',(key,)).fetchone()
        if row:article.update({k:v for k,v in json.loads(row[0]).items() if v!=''})
        return article

    def save_review(self, key, status, note, reviewer):
        if status not in {'pending', 'reviewed', 'followup'}:
            raise ValueError('请选择复核状态')
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO reviews VALUES (?, ?, ?, ?, ?)',
                       (key, status, note, datetime.now(timezone.utc).isoformat(), reviewer))

    def ledger(self, root):
        root = Path(root)
        library = json.loads((root/'_lib/lib.json').read_text(encoding='utf-8'))
        audit = json.loads((root/'data/audit-v9.json').read_text(encoding='utf-8'))
        with self.connect() as db:
            reviews = {key: {'status':status,'note':note,'updated':updated,'reviewer':reviewer}
                       for key,status,note,updated,reviewer in db.execute('SELECT * FROM reviews')}
        catalog=self.catalog();docs={d['key']:d for d in library['docs']}
        for d in catalog['upserts']:docs[d['key']]={**docs.get(d['key'],{}),**d}
        records = [{**row,'removed':row['key'] in catalog['removed'], 'review':reviews.get(row['key'], {'status':'pending','note':''})} for row in docs.values()]
        return {'total':len(records), 'records':records, 'audit':audit}
