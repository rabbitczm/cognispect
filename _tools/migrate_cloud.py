"""Prepare private local data for a one-time Cloudflare D1/R2 migration."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import time


OWNER_EMAIL = '210438161@qq.com'


def quote(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def connect(path):
    return sqlite3.connect(f'file:{Path(path).resolve().as_posix()}?mode=ro', uri=True)


def sql_insert(table, columns, values, ignore=True):
    prefix = 'INSERT OR IGNORE' if ignore else 'INSERT'
    return f"{prefix} INTO {table}({','.join(columns)}) VALUES({','.join(quote(json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v) for v in values)});"


def prepare(data_dir: Path, output: Path, owner_email=OWNER_EMAIL, owner_source=None):
    data_dir, output = data_dir.resolve(), output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sql = []
    claims = []
    r2_files = []
    users = {}

    accounts = data_dir / 'accounts.sqlite'
    if accounts.exists():
        with connect(accounts) as db:
            account_rows = list(db.execute('SELECT id,email,role,active,verified FROM users'))
            owner_row = next((row for row in account_rows if row[2] == 'owner'), None)
            if owner_row is None and owner_source:
                owner_row = next((row for row in account_rows if str(row[1] or '').strip().lower() == owner_source.lower() and row[2] in {'admin','owner'}), None)
            if owner_row is None:
                owner_row = next((row for row in account_rows if str(row[1] or '').strip().lower() == owner_email.lower() and row[2] in {'admin','owner'}), None)
            owner_id = owner_row[0] if owner_row else None
            for user_id, email, role, active, verified in account_rows:
                original = str(email or '').strip().lower()
                if user_id == owner_id:
                    email, role, verified, active = owner_email, 'owner', 1, 1
                elif original != owner_email.lower() and '@' in original and '.' in original.rsplit('@',1)[-1]:
                    email = original
                    role = role if role in {'admin','editor'} else 'user'
                else:
                    token = secrets.token_urlsafe(32)
                    hashed = hashlib.sha256(token.encode()).hexdigest()
                    email = f'legacy-{user_id}@migration.invalid'
                    role = role if role in {'admin','editor'} else 'user'
                    active, verified = 0, 0
                    claims.append((user_id, original, token, hashed, role))
                users[user_id] = email
                sql.append(sql_insert('users', ['id','email','role','active','verified','created_at'], [user_id,email,role,int(active),int(verified),0]))
            for user_id, revision, data in db.execute('SELECT user_id,revision,data FROM workspaces'):
                sql.append(sql_insert('workspaces',['user_id','revision','data'],[user_id,int(revision),data]))
            for code_hash, created_by, created_at, expires, max_uses, used in db.execute('SELECT code_hash,created_by,created_at,expires,max_uses,used FROM invites'):
                sql.append(sql_insert('invites',['code_hash','created_by','created_at','expires','max_uses','used'],[code_hash,created_by,int(created_at*1000),int(expires*1000),int(max_uses),int(used)]))

    admin_path = data_dir / 'admin' / 'management.sqlite'
    if admin_path.exists():
        with connect(admin_path) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'articles' in tables:
                for key, payload, removed, updated, editor in db.execute('SELECT key,payload,removed,updated,editor FROM articles'):
                    sql.append(sql_insert('articles',['key','payload','removed','editor','updated'],[key,payload,int(removed),editor,updated]))
            if 'reviews' in tables:
                for key, status, note, updated, reviewer in db.execute('SELECT key,status,note,updated,reviewer FROM reviews'):
                    sql.append(sql_insert('reviews',['key','status','note','updated','reviewer'],[key,status,note,updated,reviewer]))

    research_path = data_dir / 'research' / 'research.sqlite'
    if research_path.exists():
        with connect(research_path) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'submissions' in tables:
                for row in db.execute('SELECT id,owner,payload,status,review_note,published,created,updated,reviewer FROM submissions'):
                    item_id, owner, payload, status, note, published, created, updated, reviewer = row
                    if owner not in users:
                        continue
                    doc = json.loads(payload)
                    pdf_id = doc.get('pdf_id')
                    if pdf_id:
                        pdf_dir = data_dir / 'users' / owner / 'pdfs'
                        pdf = pdf_dir / f'{pdf_id}.pdf'
                        metadata = pdf_dir / f'{pdf_id}.json'
                        if pdf.is_file():
                            obj_key = f'users/{owner}/pdfs/{pdf_id}.pdf'
                            r2_files.append({'key':obj_key,'path':str(pdf),'bytes':pdf.stat().st_size})
                            meta = json.loads(metadata.read_text(encoding='utf-8')) if metadata.is_file() else {
                                'id':pdf_id, 'name':pdf.name, 'title':pdf.name, 'pages':[], 'tables':[], 'text':'',
                                'page_count':0, 'table_count':0, 'created':updated, 'bytes':pdf.stat().st_size,
                            }
                            sql.append(sql_insert('user_pdfs',['id','owner','object_key','metadata','created'],[pdf_id,owner,obj_key,json.dumps(meta,ensure_ascii=False),meta.get('created',updated)]))
                            if published and doc.get('share_pdf') and doc.get('sharing_permission'):
                                publication = json.loads(published)
                                snapshot_key = f'published-pdfs/{item_id}-{pdf_id}.pdf'
                                publication['pdf_snapshot_key'] = snapshot_key
                                published = json.dumps(publication, ensure_ascii=False)
                                r2_files.append({'key':snapshot_key,'path':str(pdf),'bytes':pdf.stat().st_size})
                    sql.append(sql_insert('submissions',['id','owner','payload','published','status','review_note','created','updated','reviewer'],[item_id,owner,payload,published,status,note,created,updated,reviewer]))
            if 'guides' in tables:
                for key, draft, published, status, note, editor, updated in db.execute('SELECT key,draft,published,status,note,editor,updated FROM guides'):
                    sql.append(sql_insert('guides',['key','draft','published','status','note','editor','updated'],[key,draft,published,status,note,editor,updated]))

    site_path = data_dir / 'site' / 'site.sqlite'
    if not site_path.exists():
        site_path = data_dir / 'site.sqlite'
    if site_path.exists():
        with connect(site_path) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'settings' in tables:
                row = db.execute('SELECT draft,published,previous,admin_limit FROM settings WHERE id=1').fetchone()
                if row:
                    sql.append(sql_insert('site_settings',['id','draft','published','previous','admin_limit'],[1,*row],ignore=False))
            if 'visibility' in tables:
                for kind, key, visible in db.execute('SELECT kind,key,visible FROM visibility'):
                    sql.append(sql_insert('visibility',['kind','item_key','visible'],[kind,key,int(visible)],ignore=False))

    copied_pdf_ids = {(item['key'].split('/')[1], Path(item['key']).stem) for item in r2_files if item['key'].startswith('users/')}
    for pdf in (data_dir / 'users').glob('*/pdfs/*.pdf'):
        user_id = pdf.parents[1].name
        if user_id not in users or (user_id, pdf.stem) in copied_pdf_ids:
            continue
        metadata_file = pdf.with_suffix('.json')
        metadata = json.loads(metadata_file.read_text(encoding='utf-8')) if metadata_file.exists() else {
            'id':pdf.stem, 'name':pdf.name, 'title':pdf.name, 'pages':[], 'tables':[], 'text':'', 'page_count':0,
            'table_count':0, 'created':'', 'bytes':pdf.stat().st_size,
        }
        obj_key = f'users/{user_id}/pdfs/{pdf.name}'
        r2_files.append({'key':obj_key,'path':str(pdf),'bytes':pdf.stat().st_size})
        sql.append(sql_insert('user_pdfs',['id','owner','object_key','metadata','created'],[pdf.stem,user_id,obj_key,json.dumps(metadata,ensure_ascii=False),metadata.get('created','')]))
        copied_pdf_ids.add((user_id, pdf.stem))

    sql_path = output / 'migration.sql'
    sql_path.write_text('\n'.join(sql) + '\n',encoding='utf-8')
    claims_path = output / 'claims-private.csv'
    with claims_path.open('w',encoding='utf-8-sig',newline='') as handle:
        writer = csv.writer(handle);writer.writerow(['user_id','previous_account','claim_token'])
        writer.writerows((user_id,previous,token) for user_id,previous,token,hashed,role in claims)
    if claims:
        claim_sql=[]
        for user_id,previous,token,hashed,role in claims:
            claim_sql.append(sql_insert('claims',['token_hash','user_id','role','target_email','expires'],[hashed,user_id,role,None,int((time.time()+30*86400)*1000)]))
        with sql_path.open('a',encoding='utf-8') as handle:handle.write('\n-- Claim tokens remain in the private CSV.\n'+'\n'.join(claim_sql)+'\n')
    manifest_path = output / 'r2-upload-manifest.json'
    manifest_path.write_text(json.dumps({'site':'cognispect','objects':len(r2_files),'r2_objects':len(r2_files),'r2_bytes':sum(x['bytes'] for x in r2_files),'files':r2_files},ensure_ascii=False,indent=2),encoding='utf-8')
    return {'users':len(users),'workspaces':sum('INSERT OR IGNORE INTO workspaces' in line for line in sql),'claim_codes':len(claims),'pdfs':sum(item['key'].startswith('users/') for item in r2_files),'public_pdf_snapshots':sum(item['key'].startswith('published-pdfs/') for item in r2_files),'site_settings':any('INSERT OR IGNORE INTO site_settings' in line or 'INSERT INTO site_settings' in line for line in sql),'sql':str(sql_path),'r2_manifest':str(manifest_path),'private_claims':str(claims_path)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,default=Path('D:/workspace/codex_list/scratch/zhijing-data'))
    parser.add_argument('--output',type=Path,default=Path('D:/workspace/codex_list/scratch/zhijing-cloud-migration'))
    parser.add_argument('--owner-email',default=OWNER_EMAIL)
    parser.add_argument('--owner-source',help=argparse.SUPPRESS)
    args=parser.parse_args()
    print(json.dumps(prepare(args.data_dir,args.output,args.owner_email,args.owner_source),ensure_ascii=False,indent=2))


if __name__=='__main__':main()
