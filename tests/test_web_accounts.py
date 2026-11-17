import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))


class WebAccounts(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('web_app'), '网站后端尚未实现')
        from fastapi.testclient import TestClient
        from web_app import create_app
        (ROOT / 'scratch/tmp').mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / 'scratch/tmp')
        self.addCleanup(self.directory.cleanup)
        self.messages = []
        self.app = create_app(self.directory.name, 'https://helix.example', self.messages.append)
        self.client = TestClient(self.app, base_url='https://helix.example')
        self.addCleanup(self.client.close)

    def register(self, email='alice@example.org', password='alice-password'):
        self.assertEqual(self.client.post('/api/auth/register', json={'email': email, 'password': password}).status_code, 200)
        token = re.search(r'token=([^\s&]+)', self.messages[-1]['text']).group(1)
        self.assertEqual(self.client.post('/api/auth/verify', json={'token': token}).status_code, 200)
        self.assertEqual(self.client.post('/api/auth/login', json={'email': email, 'password': password, 'remember': True}).status_code, 200)

    def test_registration_verification_login_logout_and_reset(self):
        self.register()
        session = self.client.get('/api/auth/session').json()
        self.assertEqual(session['user']['email'], 'alice@example.org')
        cookie = self.client.cookies.get('helix_session')
        self.assertTrue(cookie)
        self.client.post('/api/auth/logout', json={})
        self.client.cookies.set('helix_session', cookie)
        self.assertFalse(self.client.get('/api/auth/session').json()['authenticated'])
        self.client.post('/api/auth/forgot-password', json={'email': 'alice@example.org'})
        token = re.search(r'token=([^\s&]+)', self.messages[-1]['text']).group(1)
        self.assertEqual(self.client.post('/api/auth/reset-password', json={'token': token, 'password': 'new-password'}).status_code, 200)
        self.assertEqual(self.client.post('/api/auth/login', json={'email': 'alice@example.org', 'password': 'new-password'}).status_code, 200)

    def test_two_accounts_keep_workspace_and_pdf_private(self):
        self.register()
        data = {'helix.reviews.v16': json.dumps({'notes': 'Alice only'})}
        user_id = self.client.get('/api/auth/session').json()['user']['id']
        self.assertEqual(self.client.put('/api/workspace', json={'user_id': user_id, 'revision': 0, 'data': data}).status_code, 200)
        self.assertEqual(self.client.put('/api/workspace', json={'user_id': user_id, 'revision': 0, 'data': data}).status_code, 409)
        from pypdf import PdfWriter
        import io
        writer = PdfWriter(); writer.add_blank_page(width=300, height=400)
        raw = io.BytesIO(); writer.write(raw)
        uploaded = self.client.post('/api/pdf/upload', content=raw.getvalue(), headers={'X-Filename': 'alice.pdf'}).json()
        key = uploaded['id']
        self.client.post('/api/auth/logout', json={})
        self.register('bob@example.org', 'bob-password')
        self.assertEqual(self.client.get('/api/workspace').json(), {'revision': 0, 'data': {}})
        self.assertEqual(self.client.get('/api/pdfs').json(), {'documents': []})
        self.assertEqual(self.client.get('/api/pdf/document/' + key).status_code, 404)
        self.assertEqual(self.client.get('/api/pdf/file/' + key).status_code, 404)
        self.client.post('/api/pdf/remove', json={'id': key})
        self.client.post('/api/auth/logout', json={})
        self.client.post('/api/auth/login', json={'email': 'alice@example.org', 'password': 'alice-password'})
        self.assertEqual(self.client.get('/api/workspace').json()['data'], data)
        self.assertEqual(len(self.client.get('/api/pdfs').json()['documents']), 1)

    def test_disabled_user_loses_existing_session(self):
        self.register()
        self.app.state.store.create_staff('alice@example.org', '', 'user', False)
        self.assertFalse(self.client.get('/api/auth/session').json()['authenticated'])

    def test_stale_tab_cannot_write_after_same_browser_switches_account(self):
        self.register()
        alice_id = self.client.get('/api/auth/session').json()['user']['id']
        alice_data = {'helix.notes.v9': 'Alice private note from an old tab'}
        self.client.post('/api/auth/logout', json={})
        self.register('bob@example.org', 'bob-password')
        response = self.client.put('/api/workspace', json={'user_id': alice_id, 'revision': 0, 'data': alice_data})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'ACCOUNT_CHANGED')
        self.assertEqual(self.client.get('/api/workspace').json(), {'revision': 0, 'data': {}})
        bob_id = self.client.get('/api/auth/session').json()['user']['id']
        response = self.client.put('/api/workspace', json={'user_id': bob_id, 'revision': 0, 'data': {'helix.notes.v9': 'Bob note'}})
        self.assertEqual(response.status_code, 200)

    def test_workspace_write_requires_the_current_account_id(self):
        self.register()
        response = self.client.put('/api/workspace', json={'revision': 0, 'data': {'helix.notes.v9': 'Unsigned account context'}})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'ACCOUNT_CHANGED')

    def test_public_registration_requires_configured_email(self):
        from fastapi.testclient import TestClient
        from web_app import create_app
        with TestClient(create_app(Path(self.directory.name) / 'no-mail', 'https://helix.example'), base_url='https://helix.example') as client:
            self.assertEqual(client.post('/api/auth/register', json={'email': 'new@example.org', 'password': 'new-password'}).status_code, 503)

    def test_admin_invite_registers_testers_and_lists_them(self):
        self.app.state.store.create_staff('owner@example.org', 'owner-password', 'admin')
        self.assertEqual(self.client.post('/api/admin/login', json={'username': 'owner@example.org', 'password': 'owner-password'}).status_code, 200)
        created = self.client.post('/api/admin/invites', json={'uses': 1})
        self.assertEqual(created.status_code, 200)
        invite = created.json()['code']
        self.client.post('/api/auth/logout', json={})

        registered = self.client.post('/api/auth/register', json={
            'email': 'tester@example.org', 'password': 'tester-password', 'invite': invite,
        })
        self.assertEqual(registered.status_code, 200)
        self.assertEqual(registered.json()['user']['email'], 'tester@example.org')
        self.assertTrue(self.client.get('/api/auth/session').json()['authenticated'])
        self.client.post('/api/auth/logout', json={})

        self.client.post('/api/admin/login', json={'username': 'owner@example.org', 'password': 'owner-password'})
        users = self.client.get('/api/admin/users').json()['users']
        tester = next(row for row in users if row['email'] == 'tester@example.org')
        self.assertEqual(tester['role'], 'user')
        self.assertTrue(tester['verified'])
        invites = self.client.get('/api/admin/invites').json()['invites']
        self.assertEqual(invites[0]['used'], 1)

        self.client.post('/api/auth/logout', json={})
        response = self.client.post('/api/auth/register', json={
            'email': 'second@example.org', 'password': 'second-password', 'invite': invite,
        })
        self.assertEqual(response.status_code, 400)

    def test_export_files_are_private_to_the_logged_in_account(self):
        self.register()
        result = self.client.post('/api/stats', json={'csv': 'group,value\nA,1\nA,2\nA,3\nB,4\nB,5\nB,6', 'mode': 'groups'}).json()
        address = result['artifacts']['json']
        self.assertEqual(self.client.get(address).json()['n'], 6)
        self.client.post('/api/auth/logout', json={})
        self.assertEqual(self.client.get(address).status_code, 401)
        self.register('bob@example.org', 'bob-password')
        self.assertEqual(self.client.get(address).status_code, 404)

    def test_website_does_not_proxy_local_model_servers(self):
        self.register()
        for url in ('http://localhost:11434/v1', 'https://127.0.0.1/v1'):
            response = self.client.post('/api/models', json={'config': {'url': url, 'key': 'private-key'}})
            self.assertEqual(response.status_code, 400)

    def test_removed_legacy_staff_stays_removed_after_restart(self):
        from admin_store import AdminStore
        from web_store import WebStore
        directory = Path(self.directory.name) / 'migration'
        AdminStore(directory / 'admin').save_user('legacy-editor', 'editor-password', 'editor')
        store = WebStore(directory)
        self.assertIsNotNone(store.find('legacy-editor'))
        store.remove_user('legacy-editor')
        self.assertIsNone(WebStore(directory).find('legacy-editor'))

    def test_public_model_request_connects_to_the_validated_address(self):
        import web_app
        self.assertTrue(callable(getattr(web_app, 'pinned_model_opener', None)), '公网模型传输尚未绑定验证地址')
        from web_app import pinned_model_opener
        import research_api
        import io
        self.register()
        requests = []
        sockets = []
        payload = b'{"data":[{"id":"example-model"}]}'
        class Socket:
            def sendall(self, data): requests.append(data)
            def makefile(self, *args, **kwargs): return io.BytesIO(b'HTTP/1.1 200 OK\r\nContent-Length: ' + str(len(payload)).encode() + b'\r\n\r\n' + payload)
            def close(self): pass
        class Context:
            def wrap_socket(self, connection, server_hostname):
                sockets.append(server_hostname)
                return connection
        config = {'url': 'https://models.example/v1', 'key': 'session-key'}
        with patch('web_app.socket.getaddrinfo', return_value=[(2, 1, 6, '', ('8.8.8.8', 443))]), patch('web_app.socket.create_connection', return_value=Socket()) as connect, patch('web_app.ssl.create_default_context', return_value=Context()):
            self.assertEqual(research_api.model_list(config, opener=pinned_model_opener(config)), ['example-model'])
        self.assertEqual(connect.call_args.args[0], ('8.8.8.8', 443))
        self.assertEqual(sockets, ['models.example'])
        self.assertIn(b'GET /v1/models ', b''.join(requests))

    def test_publication_drafts_are_only_available_to_admin(self):
        self.register()
        directory = Path(self.directory.name) / 'publication-root'
        documents = directory / 'data/publication/documents'
        documents.mkdir(parents=True)
        draft = {'key': 'draft', 'public': False, 'publication_status': 'draft', 'license': {'eligibility': 'eligible'}, 'sections': [{'title': 'Draft full text'}]}
        published = {**draft, 'key': 'published', 'public': True, 'publication_status': 'published'}
        for document in (draft, published):
            (documents / (document['key'] + '.json')).write_text(json.dumps(document), encoding='utf-8')
        with patch('web_app.ROOT', directory):
            self.assertEqual(self.client.get('/api/publications/draft').status_code, 404)
            response = self.client.get('/api/publications/published')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['key'], 'published')
            self.assertEqual(self.client.get('/api/admin/publications/draft').status_code, 403)
            self.app.state.store.create_staff('alice@example.org', '', 'editor')
            self.assertEqual(self.client.get('/api/admin/publications/draft').status_code, 403)
            self.app.state.store.create_staff('alice@example.org', '', 'admin')
            self.assertEqual(self.client.get('/api/admin/publications/draft').json()['key'], 'draft')

    def test_admin_publication_inventory_includes_status_counts_and_source(self):
        self.register()
        directory = Path(self.directory.name) / 'inventory-root'
        source = directory / 'data/publication/manifest.json'
        source.parent.mkdir(parents=True)
        record = {'key': 'study', 'title': 'Study', 'title_zh': '研究', 'date_status': 'retained',
                  'fulltext_status': 'downloaded', 'license': {'eligibility': 'eligible'},
                  'fulltext_review_status': 'not_reviewed', 'fulltext_translation_status': 'missing',
                  'source_url': 'https://europepmc.org/article/MED/123', 'body_paragraph_count': 25,
                  'translated_paragraph_count': 0, 'source_xml': 'private-source.xml'}
        source.write_text(json.dumps({'summary': {'records': 1}, 'records': [record]}), encoding='utf-8')
        with patch('web_app.ROOT', directory):
            self.assertEqual(self.client.get('/api/admin/publications').status_code, 403)
            self.app.state.store.create_staff('alice@example.org', '', 'admin')
            response = self.client.get('/api/admin/publications')
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result['summary'], {'records': 1})
            self.assertEqual(result['records'][0]['body_paragraph_count'], 25)
            self.assertEqual(result['records'][0]['source_url'], 'https://europepmc.org/article/MED/123')
            self.assertNotIn('source_xml', result['records'][0])


if __name__ == '__main__':
    unittest.main()
