import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createPrivateStorage } from '../cloud/free-storage.js';
import { passwordHash, secretHash } from '../cloud/auth-password.js';
const { Miniflare } = await import(pathToFileURL('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare/dist/src/index.js'));
const assets = new Map();
const staticAssets = async request => {
  const path = new URL(request.url).pathname;
  if (path === '/__private_assets/manifest.json') return Response.json({ version: 1, objects: Object.fromEntries([...assets].filter(([key]) => key.startsWith('runtime/') || key.startsWith('assets/anatomy/')).map(([key, text]) => [key, { parts: ['/__private_assets/' + key], partBytes: [new TextEncoder().encode(text).length], bytes: new TextEncoder().encode(text).length, contentType: 'application/json' }])) });
  const content = assets.get(path.slice('/__private_assets/'.length));
  return content === undefined ? new Response('missing', { status: 404 }) : new Response(content, { headers: { 'content-type': 'application/json' } });
};

const mf = new Miniflare({
  modules: true,
  compatibilityDate: '2026-08-06',
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'], fallthrough: true }],
  scriptPath: 'cloud/worker.js',
  d1Databases: ['DB'],
  serviceBindings: { ASSETS: staticAssets },
  bindings: { PUBLIC_URL: 'https://example.test', OWNER_EMAIL: 'owner@example.test', RESEND_API_KEY: 'test', TEST_OTP: '654321' },
});

try {
  const db = await mf.getD1Database('DB');
  const schema = await import('node:fs/promises').then(fs => fs.readFile('cloud/migrations/0001_initial.sql', 'utf8'));
  for (const statement of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  const storageSchema = await import('node:fs/promises').then(fs => fs.readFile('cloud/migrations/0002_free_storage.sql', 'utf8'));
  for (const statement of storageSchema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  const accountSchema = await import('node:fs/promises').then(fs => fs.readFile('cloud/migrations/0003_accounts_review.sql', 'utf8'));
  for (const statement of accountSchema.split(/;\s*(?:\r?\n|$)/).map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  const revisionSchema = await import('node:fs/promises').then(fs => fs.readFile('cloud/migrations/0004_catalog_cache.sql', 'utf8').catch(() => ''));
  for (const statement of revisionSchema.split(/;\s*(?:\r?\n|$)/).map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  const literatureSchema = await import('node:fs/promises').then(fs => fs.readFile('cloud/migrations/0005_literature_search.sql', 'utf8').catch(() => ''));
  let statement='', inTrigger=false;
  for(const line of literatureSchema.split(/\r?\n/)){
    statement+=line+'\n';if(/\bBEGIN\s*$/i.test(line))inTrigger=true;
    if(/\bEND;\s*$/i.test(line))inTrigger=false;
    if(/;\s*$/.test(line)&&!inTrigger){await db.prepare(statement.trim()).run();statement='';}
  }
  await db.prepare('INSERT INTO users(id,email,role,active,verified,created_at) VALUES (?,?,?,?,?,?)')
    .bind('staff-1', 'editor@example.test', 'editor', 1, 1, Date.now()).run();
  await db.prepare('INSERT INTO users(id,email,role,active,verified,created_at) VALUES (?,?,?,?,?,?)')
    .bind('staff-2', 'other@example.test', 'user', 1, 1, Date.now()).run();
  await db.prepare('INSERT INTO users(id,email,role,active,verified,created_at) VALUES (?,?,?,?,?,?)')
    .bind('owner-1', 'owner@example.test', 'owner', 1, 1, Date.now()).run();
  for(const [id,username,password] of [['staff-1','editor','editor-password-123'],['staff-2','researcher','researcher-password-123'],['owner-1','owner','owner-password-123']])await db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?)').bind(id,username,await passwordHash(password),await secretHash(username+'-recovery'),Date.now()).run();
  await db.prepare('INSERT INTO visibility(kind,item_key,visible) VALUES (?,?,?)').bind('article', 'visible-1', 1).run();
  await db.prepare('INSERT INTO visibility(kind,item_key,visible) VALUES (?,?,?)').bind('article', 'hidden-1', 0).run();
  const storage = createPrivateStorage({ DB: db, ASSETS: { fetch: staticAssets } }, 'https://example.test');
  const bucket = { put: async (key, content) => { if (key.startsWith('users/')) return storage.put(key, content); assets.set(key, content); } };
  await bucket.put('runtime/catalog.json', JSON.stringify({ docs: [
    { key: 'visible-1', title: '公开论文', pmid: '111' },
    { key: 'hidden-1', title: '隐藏论文', pmid: '222' },
  ], abstracts: { '111': '公开摘要', '222': '隐藏摘要' }, translations: {}, translation_sources: {}, focus: [], verify: [], sources: {} }));
  await bucket.put('runtime/library-pages/index.json', JSON.stringify({ total: 2, pages: 2, chunk_size: 1 }));
  await bucket.put('runtime/library-pages/0000.json', JSON.stringify({ docs: [{ key: 'visible-1', title: '公开论文', pmid: '111' }], abstracts: { '111': '公开摘要' }, translations: { '111': '公开译文' }, translation_sources: {}, focus: { lidc: { pmid: '111', title: '专题论文' } }, verify: { '111': { source: 'Europe PMC' } }, sources: [] }));
  await bucket.put('runtime/library-pages/0001.json', JSON.stringify({ docs: [{ key: 'hidden-1', title: '隐藏论文', pmid: '222' }], abstracts: { '222': '隐藏摘要' }, translations: {}, translation_sources: {}, focus: {}, verify: {}, sources: [] }));
  await bucket.put('runtime/identifiers.json', JSON.stringify({ 'visible-1': ['visible-1', '111'], '111': ['visible-1', '111'], 'hidden-1': ['hidden-1', '222'], '222': ['hidden-1', '222'] }));
  await bucket.put('runtime/guides/visible-1.json', JSON.stringify({ key: 'visible-1', status: 'approved', sections: [{ title: '研究方法' }] }));
  await bucket.put('runtime/publications/visible-1.json', JSON.stringify({ public: true, publication_status: 'published', license: { eligibility: 'eligible' }, title: '公开全文' }));
  await bucket.put('runtime/publications/hidden-1.json', JSON.stringify({ public: true, publication_status: 'published', license: { eligibility: 'eligible' }, title: '隐藏全文' }));

  const publicRequest = (path, init = {}) => mf.dispatchFetch('https://example.test' + path, init);
  const login = await publicRequest('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'editor', password:'editor-password-123' }) });
  if (!login.ok) throw new Error('OTP login failed: ' + login.status + ' ' + await login.text());
  const sessionCookie = login.headers.get('set-cookie').split(';')[0];
  const editorRequest = (path, init = {}) => publicRequest(path, { ...init, headers: { cookie: sessionCookie, ...(init.headers || {}) } });

  const newUserLogin = await publicRequest('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username:'新研究者',password:'new-researcher-password' }) });
  assert.equal(newUserLogin.status, 200);
  assert.equal((await newUserLogin.json()).user.active, true);
  const firstLibrary = await publicRequest('/api/library');
  assert.equal(firstLibrary.status, 200, await firstLibrary.clone().text());
  await db.prepare('INSERT INTO articles(key,payload,removed,updated) VALUES(?,?,0,?)').bind('kidney-search',JSON.stringify({key:'kidney-search',pmid:'9001',title:'糖尿病肾病的临床研究',abstract:'糖尿病肾病患者的肾脏结局',authors:'Researcher',journal:'Medical Journal',year:'2024'}),new Date().toISOString()).run();
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM literature_search_records WHERE paper_key='kidney-search'").first()).n,1);
  const chineseSearch=await publicRequest('/api/library/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({groups:[['糖尿病肾病']],page:1,limit:20})});
  assert.equal(chineseSearch.status,200,await chineseSearch.clone().text());
  const chineseResults=await chineseSearch.json();assert.equal(chineseResults.docs[0]?.pmid,'9001',JSON.stringify(chineseResults));
  await db.prepare('INSERT INTO visibility(kind,item_key,visible) VALUES(?,?,0)').bind('article','9001').run();
  const hiddenSearch=await publicRequest('/api/library/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({groups:[['糖尿病肾病']],page:1,limit:20})}).then(r=>r.json());
  assert.equal(hiddenSearch.total,0);
  await db.prepare('DELETE FROM visibility WHERE kind=? AND item_key=?').bind('article','9001').run();
  await db.prepare("DELETE FROM articles WHERE key='kidney-search'").run();

  const library = await publicRequest('/api/library').then(r => r.json());
  assert.deepEqual(library.docs.map(d => d.key), ['visible-1']);
  assert.equal(library.abstracts['222'], undefined);
  assert.equal(library.focus.lidc.pmid, '111');
  assert.equal((await publicRequest('/api/guides/visible-1').then(r => r.json())).status, 'approved');
  assert.equal((await publicRequest('/api/publications/visible-1')).status, 200);
  assert.equal((await publicRequest('/api/publications/hidden-1')).status, 404);
  assert.equal((await publicRequest('/api/publications/222')).status, 404);
  await db.prepare('INSERT INTO visibility(kind,item_key,visible) VALUES (?,?,?)').bind('article', '111', 0).run();
  assert.equal((await publicRequest('/api/publications/visible-1')).status, 404);
  assert.equal((await publicRequest('/api/guides/visible-1').then(r => r.json())).guide, null);
  await db.prepare("DELETE FROM visibility WHERE kind='article' AND item_key='111'").run();
  await db.prepare('INSERT INTO articles(key,payload,removed,editor,updated) VALUES(?,?,?,?,?)')
    .bind('visible-1', JSON.stringify({ key: 'visible-1', pmid: '111', title: '编辑后的题名', abstract: '', zh: '' }), 0, 'owner@example.test', new Date().toISOString()).run();
  const editedLibrary = await publicRequest('/api/library').then(r => r.json());
  assert.equal(editedLibrary.docs.length, 1);
  assert.equal(editedLibrary.docs[0].title, '编辑后的题名');
  assert.equal(editedLibrary.abstracts['111'], '');
  assert.equal(editedLibrary.translations['111'], '');
  const editorLedger = await editorRequest('/api/admin/ledger').then(r => r.json());
  assert.equal(editorLedger.records.length, 1);
  assert.equal((await editorRequest('/api/admin/owner/admins', { method: 'POST', body: JSON.stringify({ username: 'self', role: 'admin' }) })).status, 403);
  assert.equal((await editorRequest('/api/admin/site')).status, 403);
  assert.equal((await publicRequest('/api/auth/login',{method:'POST',body:JSON.stringify({username:'editor',password:'bad-password'})})).status,401);
  await bucket.put('users/staff-2/pdfs/private.pdf', '%PDF-private');
  assert.equal((await editorRequest('/content/users/staff-2/pdfs/private.pdf')).status, 404);
  await bucket.put('runtime/bootstrap.json', '{}');
  assert.equal((await editorRequest('/content/runtime/bootstrap.json')).status, 404);

  const upload = await editorRequest('/api/pdf/upload', { method: 'POST', headers: { 'x-filename': 'shared.pdf' }, body: '%PDF-shared-test' });
  assert.equal(upload.status, 200);
  const pdf = await upload.json();
  const submissionResponse = await editorRequest('/api/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ article: { title: '公开授权测试论文', source_url: 'https://journal.example/paper' }, pdf_id: pdf.id, share_pdf: true, sharing_permission: '测试用开放授权' }) });
  assert.equal(submissionResponse.status, 200);
  const submission = await submissionResponse.json();
  assert.equal((await editorRequest(`/api/submissions/${submission.id}/submit`, { method: 'POST' })).status, 200);
  const firstPage = await publicRequest('/api/library?offset=0&limit=1').then(r => r.json());
  const finalPage = await publicRequest('/api/library?offset=1&limit=1').then(r => r.json());
  assert.equal(firstPage.docs.some(d => d.submission_id === submission.id), false);
  assert.equal(finalPage.docs.some(d => d.submission_id === submission.id), false);

  const ownerLogin = await publicRequest('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password:'owner-password-123' }) });
  assert.equal(ownerLogin.status, 200);
  const ownerCookie = ownerLogin.headers.get('set-cookie').split(';')[0];
  const ownerRequest = (path, init = {}) => publicRequest(path, { ...init, headers: { cookie: ownerCookie, ...(init.headers || {}) } });
  const usage = await ownerRequest('/api/admin/usage').then(r => r.json());
  assert.equal(usage.runtime, 'cloudflare');
  assert.equal(usage.users, 4);
  const previewSettings = await ownerRequest('/api/site?preview=1').then(r => r.json());
  assert.ok(Array.isArray(previewSettings.modules));
  assert.equal(Object.hasOwn(previewSettings, 'settings'), false);
  await ownerRequest('/api/admin/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ admin_limit: 1 }) });
  const adminCreated=await ownerRequest('/api/admin/users/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin-one', role: 'admin', active: true }) });
  assert.equal(adminCreated.status, 200, await adminCreated.clone().text());const adminPassword=(await adminCreated.json()).temporary_password;
  assert.equal((await ownerRequest('/api/admin/users/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin-two', role: 'admin', active: true }) })).status, 400);
  assert.equal((await ownerRequest('/api/admin/article/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doi: '10.5555/example.doi', title: 'DOI only paper' }) })).status, 200);
  const adminLogin = await publicRequest('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username:'admin-one',password:adminPassword }) });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const adminRequest = (path, init = {}) => publicRequest(path, { ...init, headers: { cookie: adminCookie, ...(init.headers || {}) } });
  assert.equal((await adminRequest('/api/admin/owner')).status, 403);
  assert.equal((await adminRequest('/api/admin/users/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'editor@example.test', role: 'user' }) })).status, 403);
  assert.equal((await adminRequest('/api/admin/users/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'editor@example.test' }) })).status, 403);
  assert.equal((await adminRequest('/api/admin/guides/visible-1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guide: { sections: [{ title: '方法' }] }, publish: false }) })).status, 200);
  assert.equal((await adminRequest('/api/admin/guides/visible-1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guide: { sections: [{ title: '方法' }] }, publish: true }) })).status, 200);
  assert.equal((await ownerRequest(`/api/admin/submissions/${submission.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approved', note: '' }) })).status, 200);
  const approved = await db.prepare('SELECT published FROM submissions WHERE id=?').bind(submission.id).first();
  const snapshotKey = JSON.parse(approved.published).pdf_snapshot_key;
  assert.equal(snapshotKey, `published-pdfs/${submission.id}-${pdf.id}.pdf`);
  assert.ok(await db.prepare('SELECT blob_id FROM storage_objects WHERE object_key=?').bind(snapshotKey).first());
  const approvedFinalPage = await publicRequest('/api/library?offset=1&limit=100').then(r => r.json());
  assert.equal(approvedFinalPage.docs.filter(d => d.submission_id === submission.id).length, 1);
  const catalogDelta = await publicRequest('/api/catalog').then(r => r.json());
  assert.equal(catalogDelta.upserts.filter(d => d.submission_id === submission.id).length, 1);
  assert.equal((await editorRequest('/api/pdf/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: pdf.id }) })).status, 200);
  const publicSnapshot = await publicRequest(`/api/public/submissions/${submission.id}/pdf`);
  assert.equal(publicSnapshot.status, 200);
  assert.equal(await publicSnapshot.text(), '%PDF-shared-test');
  await db.prepare('INSERT INTO visibility(kind,item_key,visible) VALUES (?,?,?)').bind('submission', submission.id, 0).run();
  assert.equal((await adminRequest('/api/admin/submissions').then(r => r.json())).records.some(item => item.id === submission.id), false);
  assert.equal((await adminRequest(`/api/admin/submissions/${submission.id}/pdf`)).status, 404);
  assert.equal((await ownerRequest('/api/public/submissions?preview=1').then(r => r.json())).records.some(item => item.id === submission.id), true);
  await db.prepare('INSERT INTO articles(key,payload,removed,editor,updated) VALUES(?,?,?,?,?)')
    .bind('hidden-1', JSON.stringify({ key: 'hidden-1', pmid: '222', title: '隐藏论文' }), 1, 'owner@example.test', new Date().toISOString()).run();
  const ownerLedger = await ownerRequest('/api/admin/ledger').then(r => r.json());
  assert.equal(ownerLedger.records.length, 3);
  assert.equal(ownerLedger.records.find(r => r.key === 'hidden-1').removed, true);
  const removals = await publicRequest('/api/catalog').then(r => r.json());
  assert.ok(removals.removed.includes('hidden-1'));
  const site = await publicRequest('/api/site').then(r => r.json());
  site.modules.find(m => m.id === 'papers').visible = false;
  site.modules.find(m => m.id === 'models').visible = false;
  await db.prepare('INSERT OR REPLACE INTO site_settings(id,draft,published,previous,admin_limit) VALUES(1,?,?,NULL,NULL)')
    .bind(JSON.stringify(site), JSON.stringify(site)).run();
  assert.deepEqual((await publicRequest('/api/public/submissions').then(r => r.json())).records, []);
  assert.equal((await publicRequest(`/api/public/submissions/${submission.id}/pdf`)).status, 404);
  assert.equal((await editorRequest('/api/submissions')).status, 404);
  assert.equal((await publicRequest('/api/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: { url: 'https://provider.example/v1' } }) })).status, 404);
  console.log('PASS new OTP account; catalog merges, DOI/PMID visibility and hidden guides; PDF isolation and durable approved snapshot; hidden module blocks old routes');
} finally {
  await mf.dispose();
}
