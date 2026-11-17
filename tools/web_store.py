"""Persistent website accounts, revocable sessions and private workspaces."""
from contextlib import contextmanager, closing
import hashlib
import hmac
import json
from pathlib import Path
import re
import secrets
import sqlite3
import time


class WorkspaceConflict(ValueError):
    def __init__(self, workspace):
        self.workspace = workspace


class WebStore:
    def __init__(self, directory):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)
        self.file = self.root / 'accounts.sqlite'
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE,salt TEXT,password TEXT,role TEXT,active INTEGER,verified INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,user_id TEXT,expires REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS mail_tokens (token TEXT PRIMARY KEY,user_id TEXT,purpose TEXT,expires REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY,created_by TEXT,created_at REAL,expires REAL,max_uses INTEGER,used INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS workspaces (user_id TEXT PRIMARY KEY,revision INTEGER,data TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS migrated_staff (email TEXT PRIMARY KEY)')
        self.import_staff()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.file, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def password_digest(password, salt):
        return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

    @staticmethod
    def public(row):
        return {key: row[key] for key in ('id', 'email', 'role', 'active', 'verified')}

    def import_staff(self):
        legacy = self.root / 'admin' / 'management.sqlite'
        if not legacy.exists():
            return
        with closing(sqlite3.connect(legacy)) as old:
            tables = {row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'staff' not in tables:
                return
            rows = old.execute('SELECT username,salt,password,role,active FROM staff').fetchall()
        with self.connect() as db:
            for email, salt, password, role, active in rows:
                email = email.strip().lower()
                if db.execute('SELECT 1 FROM migrated_staff WHERE email=?', (email,)).fetchone():
                    continue
                db.execute('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,1)', (secrets.token_hex(16), email, salt, password, role, active))
                db.execute('INSERT INTO migrated_staff VALUES (?)', (email,))

    def create_staff(self, email, password, role='admin', active=True):
        email = email.strip().lower()
        if not email or role not in {'user', 'editor', 'admin', 'owner'}:
            raise ValueError('填写账号并选择角色')
        with self.connect() as db:
            old = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            if role=='owner' and db.execute("SELECT 1 FROM users WHERE role='owner' AND email<>?",(email,)).fetchone():
                raise ValueError('网站仅有一位站主')
            if (password or not old) and len(password) < 8:
                raise ValueError('密码至少 8 位')
            salt = secrets.token_hex(16) if password else old['salt']
            digest = self.password_digest(password, salt) if password else old['password']
            user_id = old['id'] if old else secrets.token_hex(16)
            db.execute('INSERT OR REPLACE INTO users VALUES (?,?,?,?,?,?,1)', (user_id, email, salt, digest, role, int(active)))
            if old and (password or not active):
                db.execute('DELETE FROM sessions WHERE user_id=?', (user_id,))
        return {'id': user_id, 'email': email, 'role': role, 'active': bool(active), 'verified': True}

    def promote_owner(self,email):
        with self.connect() as db:
            row=db.execute('SELECT id FROM users WHERE email=?',(email,)).fetchone()
            if not row:raise ValueError('站主账号不存在')
            if db.execute("SELECT 1 FROM users WHERE role='owner' AND email<>?",(email,)).fetchone():raise ValueError('已存在其他站主')
            db.execute("UPDATE users SET role='owner',active=1 WHERE email=?",(email,))
        return self.find(email)

    def register(self, email, password):
        email = email.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('请输入有效邮箱')
        if len(password) < 8:
            raise ValueError('密码至少 8 位')
        salt = secrets.token_hex(16)
        with self.connect() as db:
            old = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            if old and old['verified']:
                raise ValueError('邮箱已注册，请登录或找回密码')
            user_id = old['id'] if old else secrets.token_hex(16)
            db.execute('INSERT OR REPLACE INTO users VALUES (?,?,?,?,\'user\',1,0)', (user_id, email, salt, self.password_digest(password, salt)))
            db.execute("DELETE FROM mail_tokens WHERE user_id=? AND purpose='verify'", (user_id,))
        return self.issue_token(user_id, 'verify')

    @staticmethod
    def invite_hash(code):
        return hashlib.sha256(code.encode()).hexdigest()

    def create_invite(self, created_by, uses=10, days=14):
        code = secrets.token_urlsafe(9)
        now = time.time()
        with self.connect() as db:
            db.execute('INSERT INTO invites VALUES (?,?,?,?,?,0)', (self.invite_hash(code), created_by, now, now + days * 86400, uses))
        return {'code': code, 'created_at': now, 'expires': now + days * 86400, 'max_uses': uses, 'used': 0}

    def invites(self):
        with self.connect() as db:
            rows = db.execute('SELECT created_by,created_at,expires,max_uses,used FROM invites ORDER BY created_at DESC').fetchall()
        return [{'created_by': row['created_by'], 'created_at': row['created_at'], 'expires': row['expires'],
                 'max_uses': row['max_uses'], 'used': row['used'], 'active': row['expires'] > time.time() and row['used'] < row['max_uses']}
                for row in rows]

    def register_invited(self, email, password, code):
        email = email.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('请输入有效邮箱')
        if len(password) < 8:
            raise ValueError('密码至少 8 位')
        if not code:
            raise ValueError('请输入测试邀请码')
        salt = secrets.token_hex(16)
        digest = self.password_digest(password, salt)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            invite = db.execute('SELECT * FROM invites WHERE code_hash=? AND expires>? AND used<max_uses', (self.invite_hash(code), time.time())).fetchone()
            if not invite:
                raise ValueError('邀请码无效、已过期或名额已用完')
            old = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            if old and old['verified']:
                raise ValueError('邮箱已注册，请登录或找回密码')
            user_id = old['id'] if old else secrets.token_hex(16)
            db.execute('INSERT OR REPLACE INTO users VALUES (?,?,?,?,\'user\',1,1)', (user_id, email, salt, digest))
            db.execute("DELETE FROM mail_tokens WHERE user_id=? AND purpose='verify'", (user_id,))
            db.execute('UPDATE invites SET used=used+1 WHERE code_hash=?', (invite['code_hash'],))
        return self.public(self.find(email))

    def issue_token(self, user_id, purpose):
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('DELETE FROM mail_tokens WHERE user_id=? AND purpose=?', (user_id, purpose))
            db.execute('INSERT INTO mail_tokens VALUES (?,?,?,?)', (token, user_id, purpose, time.time() + (86400 if purpose == 'verify' else 3600)))
        return token

    def consume_token(self, token, purpose, password=None):
        with self.connect() as db:
            row = db.execute('SELECT user_id FROM mail_tokens WHERE token=? AND purpose=? AND expires>?', (token, purpose, time.time())).fetchone()
            if not row:
                raise ValueError('链接无效或已过期，请重新申请')
            if purpose == 'verify':
                db.execute('UPDATE users SET verified=1 WHERE id=?', (row['user_id'],))
            else:
                if len(password or '') < 8:
                    raise ValueError('密码至少 8 位')
                salt = secrets.token_hex(16)
                db.execute('UPDATE users SET salt=?,password=? WHERE id=?', (salt, self.password_digest(password, salt), row['user_id']))
                db.execute('DELETE FROM sessions WHERE user_id=?', (row['user_id'],))
            db.execute('DELETE FROM mail_tokens WHERE token=?', (token,))

    def find(self, email):
        with self.connect() as db:
            row = db.execute('SELECT * FROM users WHERE email=?', (email.strip().lower(),)).fetchone()
        return self.public(row) if row else None

    def login(self, email, password, remember=False):
        with self.connect() as db:
            row = db.execute('SELECT * FROM users WHERE email=? AND active=1', (email.strip().lower(),)).fetchone()
            if not row or not hmac.compare_digest(self.password_digest(password, row['salt']), row['password']):
                raise ValueError('账号或密码不正确')
            if not row['verified']:
                raise ValueError('请先通过邮件验证邮箱')
            token = secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES (?,?,?)', (token, row['id'], time.time() + (604800 if remember else 86400)))
        return token, self.public(row)

    def identity(self, token):
        with self.connect() as db:
            row = db.execute('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE token=? AND expires>? AND active=1 AND verified=1', (token, time.time())).fetchone()
        return self.public(row) if row else None

    def logout(self, token):
        with self.connect() as db:
            db.execute('DELETE FROM sessions WHERE token=?', (token,))

    def users(self):
        with self.connect() as db:
            return [self.public(row) for row in db.execute('SELECT * FROM users ORDER BY role,email')]

    def remove_user(self, email):
        with self.connect() as db:
            row = db.execute('SELECT id FROM users WHERE email=?', (email.strip().lower(),)).fetchone()
            if row:
                db.execute('DELETE FROM sessions WHERE user_id=?', (row['id'],))
                db.execute('DELETE FROM mail_tokens WHERE user_id=?', (row['id'],))
                db.execute('DELETE FROM users WHERE id=?', (row['id'],))

    def workspace(self, user_id):
        with self.connect() as db:
            row = db.execute('SELECT revision,data FROM workspaces WHERE user_id=?', (user_id,)).fetchone()
        return {'revision': row['revision'], 'data': json.loads(row['data'])} if row else {'revision': 0, 'data': {}}

    def save_workspace(self, user_id, revision, data):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision,data FROM workspaces WHERE user_id=?', (user_id,)).fetchone()
            current = {'revision': row['revision'], 'data': json.loads(row['data'])} if row else {'revision': 0, 'data': {}}
            if revision != current['revision']:
                raise WorkspaceConflict(current)
            revision += 1
            db.execute('INSERT OR REPLACE INTO workspaces VALUES (?,?,?)', (user_id, revision, json.dumps(data, ensure_ascii=False)))
        return {'revision': revision, 'data': data}

    def user_directory(self, user_id):
        directory = self.root / 'users' / user_id
        directory.mkdir(parents=True, exist_ok=True)
        return directory
