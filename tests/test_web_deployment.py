"""Deployment flows exercised with real SQLite files and private user documents."""
from contextlib import closing, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from admin_store import AdminStore
from web_store import WebStore
import web_manage


class WebDeployment(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / 'scratch' / 'tmp'
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.data = self.base / 'data'

    def cli(self, *arguments):
        return subprocess.run(
            [sys.executable, str(ROOT / 'tools' / 'web_manage.py'), *map(str, arguments)],
            capture_output=True, text=True, encoding='utf-8',
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONIOENCODING': 'utf-8',
                 'TEMP': str(self.base), 'TMP': str(self.base)},
        )

    def test_admin_cli_creates_usable_account_without_outputting_password(self):
        output = StringIO()
        with patch.object(sys, 'argv', ['web_manage', 'init-admin', '--data-dir', str(self.data), '--email', 'owner@example.org']), patch('getpass.getpass', side_effect=['admin-test-password', 'admin-test-password']), redirect_stdout(output):
            web_manage.main()
        receipt = json.loads(output.getvalue())
        self.assertNotIn('admin-test-password', output.getvalue())
        identity = WebStore(self.data).login('owner@example.org', 'admin-test-password')[1]
        self.assertEqual(identity['id'], receipt['id'])
        self.assertEqual(identity['role'], 'admin')

    def test_legacy_import_preserves_staff_password_and_assigns_pdf_to_owner(self):
        owner = WebStore(self.data).create_staff('owner@example.org', 'admin-test-password')
        old = AdminStore(self.base / 'legacy')
        old.save_user('legacy-editor', 'legacy-test-password', 'editor', True)
        with old.connect() as db:
            db.execute("INSERT INTO articles VALUES ('paper','{}',0,'2026-11-15','legacy-editor')")
        pdfs = self.base / 'pdfs'
        pdfs.mkdir()
        (pdfs / 'paper.pdf').write_bytes(b'%PDF-legacy-document')
        (pdfs / 'paper.json').write_text('{"id":"paper"}', encoding='utf-8')
        result = self.cli('import-legacy', '--data-dir', self.data, '--database', self.base / 'legacy' / 'management.sqlite', '--pdf-dir', pdfs, '--owner-id', owner['id'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(WebStore(self.data).login('legacy-editor', 'legacy-test-password')[1]['role'], 'editor')
        self.assertEqual((self.data / 'users' / owner['id'] / 'pdfs' / 'paper.pdf').read_bytes(), b'%PDF-legacy-document')
        with closing(sqlite3.connect(self.data / 'admin' / 'management.sqlite')) as db:
            self.assertEqual(db.execute('SELECT key FROM articles').fetchone()[0], 'paper')

    def test_backup_restores_login_private_notes_and_pdf_into_isolated_directory(self):
        store = WebStore(self.data)
        owner = store.create_staff('owner@example.org', 'admin-test-password')
        store.save_workspace(owner['id'], 0, {'helix.notes.v9': '我的论文笔记'})
        pdf = store.user_directory(owner['id']) / 'pdfs' / 'paper.pdf'
        pdf.parent.mkdir()
        pdf.write_bytes(b'%PDF-user-document')
        archive = self.base / 'backup.tar.gz'
        result = self.cli('backup', '--data-dir', self.data, '--output', archive)
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(archive) as bundle:
            manifest = json.load(bundle.extractfile('manifest.json'))
            self.assertEqual(manifest['format'], 'helix-backup-v1')
            self.assertIn('accounts.sqlite', {item['path'] for item in manifest['files']})
            self.assertIn('users/' + owner['id'] + '/pdfs/paper.pdf', {item['path'] for item in manifest['files']})
        target = self.base / 'restored'
        result = self.cli('restore', '--archive', archive, '--data-dir', target)
        self.assertEqual(result.returncode, 0, result.stderr)
        restored = WebStore(target)
        self.assertEqual(restored.login('owner@example.org', 'admin-test-password')[1]['id'], owner['id'])
        self.assertEqual(restored.workspace(owner['id'])['data']['helix.notes.v9'], '我的论文笔记')
        self.assertEqual((target / 'users' / owner['id'] / 'pdfs' / 'paper.pdf').read_bytes(), b'%PDF-user-document')
        result = self.cli('restore', '--archive', archive, '--data-dir', target)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(restored.workspace(owner['id'])['data']['helix.notes.v9'], '我的论文笔记')

    def test_source_export_contains_required_files_and_omits_runtime_and_restricted_bodies(self):
        source = self.base / 'source'
        source.mkdir()
        files = {
            'app.template.html': '<html>source</html>', 'PUBLICATION.md': 'source policy',
            'tools/web_app.py': 'source', 'tools/runtime.local.json': 'local secret',
            'deploy/env.example': 'PUBLIC_URL=https://cognispect.tech', 'deploy/.env': 'SMTP_PASSWORD=local-secret',
            '_lib/app.js': 'source', '_tools/translate_publication.py': 'source',
            'data/stats.json': '{}', 'data/private.sqlite': 'private data',
            'data/publication/documents/allowed.json': '{"license":{"eligibility":"eligible"}}',
            'data/publication/documents/nd.json': '{"license":{"eligibility":"permission_required_nd"}}',
            'data/publication/sources/raw.xml': 'restricted source body',
            'data/publication/sources/metadata/europepmc-123.json': '{"source":"official metadata"}',
            'verification/screenshot.png': 'private', 'scratch/server.log': 'private',
            '_tools/old_browser_test.js': 'historical',
        }
        for name, value in files.items():
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding='utf-8')
        target, archive = self.base / 'clean', self.base / 'clean.zip'
        result = subprocess.run([sys.executable, str(ROOT / '_tools' / 'prepare_web_release.py'), '--source', str(source), '--output', str(target), '--archive', str(archive)], capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONIOENCODING': 'utf-8'})
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = {'app.template.html', 'PUBLICATION.md', 'tools/web_app.py', 'deploy/env.example', '_lib/app.js', '_tools/translate_publication.py', 'data/stats.json', 'data/publication/documents/allowed.json', 'data/publication/sources/metadata/europepmc-123.json'}
        self.assertEqual({p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}, expected)
        with zipfile.ZipFile(archive) as bundle:
            self.assertEqual(set(bundle.namelist()), {'clean/' + name for name in expected})


if __name__ == '__main__':
    unittest.main()
