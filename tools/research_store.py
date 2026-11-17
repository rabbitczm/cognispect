"""Research submissions, editorial guide versions and shared protocols."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import sqlite3
from urllib.parse import urlsplit


def now():
    return datetime.now(timezone.utc).isoformat()


def source_url(value):
    value = str(value or '').strip()
    if value and (urlsplit(value).scheme not in {'http', 'https'} or not urlsplit(value).netloc):
        raise ValueError('原文链接需要以 http:// 或 https:// 开头')
    return value


class ResearchStore:
    def __init__(self, directory, root):
        self.root = Path(root)
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.file = self.directory / 'research.sqlite'
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, owner TEXT, payload TEXT, status TEXT, review_note TEXT, published TEXT, created TEXT, updated TEXT, reviewer TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS guides (key TEXT PRIMARY KEY, draft TEXT, published TEXT, status TEXT, note TEXT, editor TEXT, updated TEXT)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.file)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def submission(self, key, owner=None):
        with self.connect() as db:
            row = db.execute('SELECT * FROM submissions WHERE id=?', (key,)).fetchone()
        if row is None or (owner is not None and row['owner'] != owner):
            return None
        return {**json.loads(row['payload']), **{k:row[k] for k in ('id','owner','status','review_note','created','updated','reviewer')}, 'has_published':bool(row['published'])}

    def submissions(self, owner=None, public=False):
        with self.connect() as db:
            rows = db.execute('SELECT * FROM submissions ORDER BY updated DESC').fetchall()
        if public:
            return [json.loads(r['published']) for r in rows if r['published']]
        return [self.submission(r['id']) for r in rows if owner is None or r['owner'] == owner]

    def save_submission(self, payload, owner, key=None):
        previous = self.submission(key, owner) if key else None
        if key and previous is None:
            raise LookupError('投稿不存在')
        fields={'title','authors','journal','year','doi','pmid','source_url','abstract'}
        article = {k:v for k,v in (payload.get('article') or {}).items() if k in fields}
        if not str(article.get('title', '')).strip():
            raise ValueError('请填写已发表论文题名')
        article['source_url'] = source_url(article.get('source_url'))
        if not (article.get('doi') or article.get('pmid') or article['source_url']):
            raise ValueError('请填写 DOI、PMID 或原文链接')
        key = key or secrets.token_hex(12)
        data = {'article':article, 'guide':payload.get('guide') or {'sections':[]}, 'protocol':payload.get('protocol') or {},
                'pdf_id':str(payload.get('pdf_id') or ''), 'share_pdf':bool(payload.get('share_pdf')), 'sharing_permission':str(payload.get('sharing_permission') or ''), 'id':key}
        with self.connect() as db:
            db.execute("INSERT INTO submissions VALUES (?,?,?,'draft','',NULL,?,?,NULL) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status='draft',updated=excluded.updated", (key,owner,json.dumps(data,ensure_ascii=False),now(),now()))
        return self.submission(key,owner)

    def submit(self, key, owner):
        if self.submission(key,owner) is None:
            raise LookupError('投稿不存在')
        with self.connect() as db:
            db.execute("UPDATE submissions SET status='pending', updated=? WHERE id=?", (now(),key))
        return self.submission(key,owner)

    def review_submission(self, key, decision, note, reviewer):
        item = self.submission(key)
        if not item:
            raise LookupError('投稿不存在')
        if decision not in {'approved','returned'}:
            raise ValueError('请选择通过或退回修改')
        if item['status'] != 'pending':
            raise ValueError('请先提交审核')
        published = None
        if decision == 'approved':
            published = {k:item[k] for k in ('id','article','guide','protocol','share_pdf','pdf_id','sharing_permission')}
            published.update(published_at=now(), status='approved')
        with self.connect() as db:
            db.execute('UPDATE submissions SET status=?,review_note=?,reviewer=?,updated=?,published=COALESCE(?,published) WHERE id=?',
                       (decision,str(note),reviewer,now(),json.dumps(published,ensure_ascii=False) if published else None,key))
        return self.submission(key)

    def base_guide(self, key):
        path = self.root / 'data' / 'paper-guides' / (key + '.json')
        return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None

    def guide(self, key, editorial=False):
        with self.connect() as db:
            row = db.execute('SELECT * FROM guides WHERE key=?',(key,)).fetchone()
        if editorial:
            if row:
                return {**json.loads(row['draft']), 'status':row['status'],'review_note':row['note']}
            return self.base_guide(key)
        return json.loads(row['published']) if row and row['published'] else None

    def guide_index(self):
        file = self.root / 'data/paper-guides/index.json'
        records = json.loads(file.read_text(encoding='utf-8')).get('records',[]) if file.exists() else []
        with self.connect() as db:
            edits = {r['key']:r for r in db.execute('SELECT key,status,updated FROM guides')}
        return [{**r, **({'status':edits[r['key']]['status'],'updated':edits[r['key']]['updated']} if r['key'] in edits else {})} for r in records]

    def save_guide(self, key, payload, editor, publish=False, note=''):
        if publish and not payload.get('sections'):
            raise ValueError('请先填写讲解内容')
        draft = {**payload,'key':key,'status':'approved' if publish else 'draft','updated':now()}
        published = {**draft,'reviewer':editor,'published_at':now()} if publish else None
        with self.connect() as db:
            db.execute('INSERT INTO guides VALUES (?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET draft=excluded.draft,published=COALESCE(excluded.published,guides.published),status=excluded.status,note=excluded.note,editor=excluded.editor,updated=excluded.updated',
                       (key,json.dumps(draft,ensure_ascii=False),json.dumps(published,ensure_ascii=False) if published else None,draft['status'],str(note),editor,now()))
        return draft
