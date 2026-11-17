import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from fastapi.testclient import TestClient
from web_app import create_app


class OwnerSiteFlows(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / 'scratch/tmp')
        self.addCleanup(self.tmp.cleanup)
        self.app = create_app(self.tmp.name, 'https://site.example')
        self.app.state.store.create_staff('owner@example.org', 'owner-password', role='owner')
        self.app.state.store.create_staff('admin@example.org', 'admin-password', role='admin')
        self.client = TestClient(self.app, base_url='https://site.example')
        self.addCleanup(self.client.close)

    def login(self, who):
        self.assertEqual(self.client.post('/api/auth/login', json={'email':who+'@example.org', 'password':who+'-password'}).status_code, 200)

    def test_owner_publishes_and_restores_site_while_admin_cannot(self):
        self.login('owner')
        settings = self.client.get('/api/admin/site').json()['draft']
        original = settings['hero_title']
        settings['hero_title'] = '从证据到复现'
        self.assertEqual(self.client.put('/api/admin/site', json={'settings':settings}).status_code, 200)
        self.assertEqual(self.client.get('/api/site').json()['hero_title'], original)
        self.client.post('/api/admin/site/publish', json={})
        self.assertEqual(self.client.get('/api/site').json()['hero_title'], '从证据到复现')
        self.client.post('/api/admin/site/restore', json={})
        self.assertEqual(self.client.get('/api/site').json()['hero_title'], original)
        self.login('admin')
        self.assertEqual(self.client.put('/api/admin/site', json={'settings':settings}).status_code, 403)
        self.assertEqual(self.client.post('/api/admin/users/save', json={'email':'new@example.org','password':'new-password','role':'admin'}).status_code, 403)

    def test_owner_manages_admin_seats_and_hidden_article_is_not_in_library(self):
        self.login('owner')
        self.client.post('/api/admin/owner', json={'admin_limit':1})
        response=self.client.post('/api/admin/users/save', json={'email':'new@example.org','password':'new-password','role':'admin'})
        self.assertEqual(response.status_code, 409)
        self.client.post('/api/admin/users/save', json={'email':'admin@example.org','role':'user'})
        self.assertEqual(self.client.post('/api/admin/users/save', json={'email':'new@example.org','password':'new-password','role':'admin'}).status_code, 200)
        self.assertEqual(self.client.post('/api/admin/users/save', json={'email':'owner@example.org','role':'user'}).status_code, 403)
        self.client.post('/api/admin/owner', json={'admin_limit':2})
        self.client.post('/api/admin/users/save', json={'email':'admin@example.org','role':'admin'})
        self.client.post('/api/admin/visibility', json={'kind':'article','key':'25554246','visible':False})
        self.client.post('/api/auth/logout', json={})
        library=self.client.get('/api/library').json()
        self.assertNotIn('25554246', [d['key'] for d in library['docs']])
        self.assertNotIn('25554246', library['abstracts'])
        self.assertEqual(self.client.get('/api/publications/25554246').status_code,404)
        self.login('admin')
        self.assertEqual(self.client.get('/api/admin/guides/25554246').status_code,404)
        self.client.post('/api/auth/logout',json={})
        self.assertNotIn('Preferred reporting items for systematic review and meta-analysis protocols',self.client.get('/?intro=done').text)
        self.login('owner')
        self.assertIn('25554246',[d['key'] for d in self.client.get('/api/library?preview=1').json()['docs']])
        self.client.post('/api/admin/visibility',json={'kind':'module','key':'stats','visible':False})
        self.client.post('/api/auth/logout',json={})
        self.assertEqual(self.client.post('/api/stats',json={'mode':'paired'}).status_code,404)
