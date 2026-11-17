import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from fastapi.testclient import TestClient
from web_app import create_app


class ResearchWorkflows(unittest.TestCase):
    def setUp(self):
        (ROOT / 'scratch/tmp').mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / 'scratch/tmp')
        self.addCleanup(self.directory.cleanup)
        self.app = create_app(self.directory.name, 'https://study.example')
        self.owner = self.app.state.store.create_staff('author@example.org', 'author-password', role='user')
        self.app.state.store.create_staff('admin@example.org', 'admin-password', role='admin')
        self.client = TestClient(self.app, base_url='https://study.example')
        self.addCleanup(self.client.close)

    def login(self, email, password):
        self.assertEqual(self.client.post('/api/auth/login', json={'email':email,'password':password}).status_code, 200)

    def test_author_submits_admin_returns_then_publishes_and_edits_stay_private(self):
        self.login('author@example.org', 'author-password')
        payload = {'article':{'title':'A published medical study','doi':'10.1000/study','source_url':'https://journal.example/study'},
                   'guide':{'sections':[{'id':'question','title':'研究问题','text':'比较随访变化','evidence':[]}]},
                   'protocol':{'goal':'比较前后变化','steps':[{'instruction':'导入测量表','expected':'患者配对数据','actual':'已配对'}]}}
        response = self.client.post('/api/submissions', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        paper = response.json()
        self.assertEqual(self.client.post('/api/submissions/'+paper['id']+'/submit', json={}).status_code, 200)
        self.assertEqual(self.client.get('/api/public/submissions').json()['records'], [])
        self.login('admin@example.org', 'admin-password')
        self.assertEqual(self.client.post('/api/admin/submissions/'+paper['id']+'/review', json={'decision':'returned','note':'补充复现参数'}).status_code, 200)
        self.login('author@example.org', 'author-password')
        self.assertEqual(self.client.get('/api/submissions/'+paper['id']).json()['review_note'], '补充复现参数')
        self.client.post('/api/submissions/'+paper['id']+'/submit', json={})
        self.login('admin@example.org', 'admin-password')
        published = self.client.post('/api/admin/submissions/'+paper['id']+'/review', json={'decision':'approved','note':'核对完成'})
        self.assertEqual(published.status_code, 200, published.text)
        public = self.client.get('/api/public/submissions').json()['records'][0]
        self.assertEqual(public['protocol']['steps'][0]['actual'], '已配对')
        self.login('author@example.org', 'author-password')
        payload['guide']['sections'][0]['text'] = '修改中的讲解'
        self.client.put('/api/submissions/'+paper['id'], json=payload)
        self.assertEqual(self.client.get('/api/public/submissions').json()['records'][0]['guide']['sections'][0]['text'], '比较随访变化')

    def test_other_user_cannot_read_private_submission(self):
        self.login('author@example.org', 'author-password')
        response = self.client.post('/api/submissions', json={'article':{'title':'Private draft','source_url':'https://journal.example/paper'}})
        self.assertEqual(response.status_code, 200, response.text)
        key = response.json()['id']
        self.app.state.store.create_staff('other@example.org','other-password',role='user')
        self.login('other@example.org', 'other-password')
        self.assertEqual(self.client.get('/api/submissions/'+key).status_code, 404)

    def test_upload_limit_stops_oversized_body_before_pdf_parse(self):
        self.login('author@example.org', 'author-password')
        self.app.state.config.max_upload_bytes = 32
        response = self.client.post('/api/pdf/upload', content=b'%PDF-'+b'a'*80, headers={'X-Filename':'paper.pdf'})
        self.assertEqual(response.status_code, 413, response.text)

    def test_guide_drafts_need_admin_publication_and_edits_preserve_published_version(self):
        self.login('admin@example.org', 'admin-password')
        guide={'title':'医学方法讲解','basis':'abstract','sections':[{'id':'question','title':'研究问题','text':'已核对的讲解'}]}
        self.client.post('/api/admin/guides/25554246',json={'guide':guide})
        self.assertIsNone(self.client.get('/api/guides/25554246').json()['guide'])
        self.client.post('/api/admin/guides/25554246',json={'guide':guide,'publish':True})
        guide['sections'][0]['text']='修改中的讲解'
        self.client.post('/api/admin/guides/25554246',json={'guide':guide})
        self.assertEqual(self.client.get('/api/guides/25554246').json()['guide']['sections'][0]['text'],'已核对的讲解')
        self.login('author@example.org','author-password')
        self.assertEqual(self.client.post('/api/admin/guides/25554246',json={'guide':guide,'publish':True}).status_code,403)

    def test_published_pdf_remains_available_after_author_deletes_private_copy(self):
        from pypdf import PdfWriter
        writer=PdfWriter();writer.add_blank_page(width=300,height=400)
        buffer=io.BytesIO();writer.write(buffer)
        self.login('author@example.org','author-password')
        pdf=self.client.post('/api/pdf/upload',content=buffer.getvalue(),headers={'X-Filename':'study.pdf'}).json()
        item=self.client.post('/api/submissions',json={'article':{'title':'开放论文','source_url':'https://journal.example/open'},'pdf_id':pdf['id'],'share_pdf':True,'sharing_permission':'原文 CC BY 4.0'}).json()
        self.client.post('/api/submissions/'+item['id']+'/submit',json={})
        self.login('admin@example.org','admin-password')
        approved=self.client.post('/api/admin/submissions/'+item['id']+'/review',json={'decision':'approved'})
        self.assertEqual(approved.status_code,200,approved.text)
        self.login('author@example.org','author-password')
        self.client.post('/api/pdf/remove',json={'id':pdf['id']})
        self.client.post('/api/auth/logout',json={})
        public=self.client.get('/api/public/submissions/'+item['id']+'/pdf')
        self.assertEqual(public.status_code,200,public.text)
        self.assertEqual(public.content,buffer.getvalue())


if __name__ == '__main__':
    unittest.main()
