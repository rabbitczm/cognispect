"""知镜网站的账号、旧版迁移和数据备份命令。"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def web_store(directory):
    try:
        from .web_store import WebStore
    except ImportError:
        from web_store import WebStore
    return WebStore(directory)


def sqlite_copy(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as incoming:
        with closing(sqlite3.connect(target)) as outgoing:
            incoming.backup(outgoing)


def backup(directory: Path, output: Path):
    directory = directory.resolve()
    output = output.resolve()
    if not directory.is_dir():
        raise ValueError('Data directory does not exist: ' + str(directory))
    if output.is_relative_to(directory):
        raise ValueError('Write the backup outside the data directory.')
    if output.exists():
        raise ValueError('Backup file already exists: ' + str(output))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='helix-backup-', dir=output.parent) as temporary:
        stage = Path(temporary)
        files = []
        for source in sorted(directory.rglob('*')):
            if not source.is_file() or source.name.endswith(('-wal', '-shm', '-journal')):
                continue
            relative = source.relative_to(directory)
            target = stage / 'data' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.suffix in {'.sqlite', '.sqlite3', '.db'}:
                sqlite_copy(source, target)
            else:
                shutil.copy2(source, target)
            files.append({'path': relative.as_posix(), 'bytes': target.stat().st_size})
        manifest = {'format': 'helix-backup-v1', 'created_utc': datetime.now(timezone.utc).isoformat(), 'files': files}
        (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        pending = stage / 'backup.tar.gz'
        with tarfile.open(pending, 'w:gz') as archive:
            archive.add(stage / 'manifest.json', arcname='manifest.json')
            for item in files:
                archive.add(stage / 'data' / item['path'], arcname='data/' + item['path'], recursive=False)
        pending.replace(output)
    return {'archive': str(output), 'files': len(files), 'bytes': output.stat().st_size}


def restore(directory: Path, archive_path: Path):
    directory = directory.resolve()
    if directory.exists() and any(directory.iterdir()):
        raise ValueError('Restore requires an empty destination; use a new directory for the rehearsal.')
    with tarfile.open(archive_path, 'r:gz') as archive:
        manifest_member = archive.extractfile('manifest.json')
        if manifest_member is None:
            raise ValueError('Backup manifest is missing.')
        manifest = json.load(manifest_member)
        if manifest.get('format') != 'helix-backup-v1':
            raise ValueError('不支持的知镜备份格式。')
        members = []
        for item in manifest['files']:
            target = (directory / item['path']).resolve()
            member = archive.getmember('data/' + item['path'])
            if not target.is_relative_to(directory) or not member.isfile() or member.size != item['bytes']:
                raise ValueError('Invalid backup member: ' + item['path'])
            members.append((member, target))
        directory.mkdir(parents=True, exist_ok=True)
        for member, target in members:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as incoming, target.open('wb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
        for database in directory.rglob('*.sqlite'):
            with closing(sqlite3.connect(database)) as db:
                if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Restored SQLite could not be read: ' + str(database))
    return {'restored_to': str(directory), 'files': len(members), 'created_utc': manifest['created_utc']}


def import_legacy(directory: Path, database: Path, pdf_directory: Path | None, owner_id: str):
    web_store(directory)
    with closing(sqlite3.connect(directory / 'accounts.sqlite')) as accounts:
        owner = accounts.execute('SELECT id,email FROM users WHERE id=?', (owner_id,)).fetchone()
    if owner is None:
        raise ValueError('Choose an existing owner ID from the users command.')
    sources = []
    pdf_destination = directory / 'users' / owner_id / 'pdfs'
    if pdf_directory:
        sources = [p for p in pdf_directory.iterdir() if p.is_file() and p.suffix.lower() in {'.pdf', '.json'}]
        conflicts = [p.name for p in sources if (pdf_destination / p.name).exists()]
        if conflicts:
            raise ValueError('PDF files already exist; import into a fresh user: ' + ', '.join(conflicts[:5]))
    destination = directory / 'admin' / 'management.sqlite'
    destination.parent.mkdir(parents=True, exist_ok=True)
    imported = {}
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as incoming, closing(sqlite3.connect(destination)) as outgoing:
        for table in ('account', 'staff', 'reviews', 'articles'):
            definition = incoming.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
            if not definition:
                continue
            outgoing.execute(definition[0].replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ', 1))
            columns = [row[1] for row in incoming.execute('PRAGMA table_info(' + table + ')')]
            rows = incoming.execute('SELECT * FROM ' + table).fetchall()
            statement = 'INSERT OR IGNORE INTO ' + table + ' (' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')'
            before = outgoing.total_changes
            outgoing.executemany(statement, rows)
            imported[table] = outgoing.total_changes - before
        outgoing.commit()
    web_store(directory)
    copies = 0
    if sources:
        pdf_destination.mkdir(parents=True, exist_ok=True)
        for source in sources:
            shutil.copy2(source, pdf_destination / source.name)
            copies += 1
    return {'owner_id': owner_id, 'owner': owner[1], 'legacy_records_added': imported, 'pdf_files_added': copies}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('init-admin', 'promote-owner', 'users', 'import-legacy', 'backup', 'restore'):
        command = commands.add_parser(name)
        command.add_argument('--data-dir', type=Path, default=Path(os.getenv('HELIX_DATA_DIR', ROOT / 'scratch' / 'web-data')))
        if name in {'init-admin','promote-owner'}:
            command.add_argument('--email', required=True)
        elif name == 'import-legacy':
            command.add_argument('--database', required=True, type=Path)
            command.add_argument('--pdf-dir', type=Path)
            command.add_argument('--owner-id', required=True)
        elif name == 'backup':
            command.add_argument('--output', required=True, type=Path)
        elif name == 'restore':
            command.add_argument('--archive', required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'init-admin':
            password = getpass.getpass('管理员密码: ')
            if password != getpass.getpass('再次输入密码: '):
                raise ValueError('两次密码不一致。')
            if not password:
                raise ValueError('请输入密码。')
            user = web_store(args.data_dir).create_staff(args.email, password, role='admin', active=True)
            result = {key: user[key] for key in ('id', 'email', 'role')}
        elif args.command == 'promote-owner':
            identity=web_store(args.data_dir).promote_owner(args.email)
            result={'id':identity['id'],'role':identity['role']}
        elif args.command == 'users':
            web_store(args.data_dir)
            with closing(sqlite3.connect(args.data_dir / 'accounts.sqlite')) as db:
                db.row_factory = sqlite3.Row
                result = [dict(row) for row in db.execute('SELECT id,email,role,active,verified FROM users ORDER BY email')]
        elif args.command == 'import-legacy':
            result = import_legacy(args.data_dir, args.database, args.pdf_dir, args.owner_id)
        elif args.command == 'backup':
            result = backup(args.data_dir, args.output)
        else:
            result = restore(args.data_dir, args.archive)
    except (ValueError, OSError, sqlite3.Error, tarfile.TarError) as exc:
        parser.exit(1, str(exc) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
