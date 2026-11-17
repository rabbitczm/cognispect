import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const moduleUrl = new URL('../cloud/free-storage.js', import.meta.url);
const available = await fs.access(moduleUrl).then(() => true, () => false);
assert.equal(available, true, 'free-storage adapter must exist before the free deployment can save PDFs');
const { Miniflare } = await import(pathToFileURL('D:/workspace/codex_list/tools/helix-cloud-tools/node_modules/miniflare/dist/src/index.js'));
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'], fallthrough: true }],
  scriptPath: '_tools/free_storage_harness.mjs', compatibilityDate: '2026-08-06', d1Databases: ['DB'],
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname;
    if (path === '/__private_assets/manifest.json') return Response.json({ version: 1, objects: {
      'runtime/example.json': { parts: ['/__private_assets/first', '/__private_assets/second'], partBytes: [7, 11], bytes: 18, contentType: 'application/json' },
    } });
    if (path.endsWith('/first')) return new Response('{"title');
    if (path.endsWith('/second')) return new Response('\":\"知镜\"}');
    return new Response('missing', { status: 404 });
  } },
});
try {
  const db = await mf.getD1Database('DB');
  const schema = await fs.readFile('cloud/migrations/0002_free_storage.sql', 'utf8');
  for (const statement of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  const invoke = (action, key, { bytes, ...params } = {}) => mf.dispatchFetch('https://storage.test/?' + new URLSearchParams({ action, key, ...params }), bytes === undefined ? {} : { method: 'POST', body: bytes });
  const ok = async response => { assert.equal(response.status, 200, await response.clone().text()); return response; };

  const staticObject = await ok(await invoke('get', 'runtime/example.json'));
  assert.deepEqual(await staticObject.json(), { title: '知镜' });
  assert.match(staticObject.headers.get('content-type'), /application\/json/);
  assert.equal((await invoke('get', 'runtime/missing.json')).status, 404);

  const key = 'users/alice/pdfs/test.pdf';
  await ok(await invoke('put', key, { bytes: '%PDF-original', type: 'application/pdf' }));
  assert.equal(await (await ok(await invoke('get', key))).text(), '%PDF-original');
  await ok(await invoke('copy', key, { target: 'published-pdfs/study.pdf' }));
  await ok(await invoke('put', key, { bytes: '%PDF-replacement', type: 'application/pdf' }));
  await ok(await invoke('delete', key));
  assert.equal((await invoke('get', key)).status, 404);
  assert.equal(await (await ok(await invoke('get', 'published-pdfs/study.pdf'))).text(), '%PDF-original');

  const uploadKey = 'users/alice/pdfs/chunked.pdf', chunk = new Uint8Array(1024 * 1024).fill(65);
  await ok(await invoke('start', uploadKey, { total: String(chunk.length + 4), type: 'application/pdf' }));
  await ok(await invoke('chunk', uploadKey, { index: '0', bytes: chunk }));
  assert.equal((await invoke('get', uploadKey)).status, 404, 'incomplete uploads are not readable');
  assert.equal((await invoke('complete', uploadKey)).status, 409);
  await ok(await invoke('chunk', uploadKey, { index: '1', bytes: 'TAIL' }));
  await ok(await invoke('complete', uploadKey));
  await ok(await invoke('complete', uploadKey));
  assert.equal(await (await ok(await invoke('get', uploadKey, { offset: String(chunk.length - 2), length: '6' }))).text(), 'AATAIL');
  await ok(await invoke('delete', uploadKey));
  await ok(await invoke('delete', 'published-pdfs/study.pdf'));
  await ok(await invoke('start', uploadKey, { total: String(chunk.length + 4), type: 'application/pdf' }));
  await ok(await invoke('chunk', uploadKey, { index: '0', bytes: chunk }));
  await ok(await invoke('delete', uploadKey));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM storage_blobs').first()).n, 0, 'unreferenced file chunks are reclaimed');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM storage_chunks').first()).n, 0, 'deletion reclaims the bytes as well as the metadata');
  assert.equal((await invoke('start', uploadKey, { total: String(30 * 1024 * 1024 + 1), type: 'application/pdf' })).status, 413);
  await db.prepare('INSERT INTO storage_blobs(id,size,content_type,complete,created) VALUES(?,?,?,?,?)').bind('reserved', 499 * 1024 * 1024, 'application/pdf', 0, Date.now()).run();
  const full = await invoke('start', uploadKey, { total: String(2 * 1024 * 1024), type: 'application/pdf' });
  assert.equal(full.status, 507);
  assert.match(await full.text(), /免费.*存储/);
  await db.prepare("DELETE FROM storage_blobs WHERE id='reserved'").run();
  const migrationTool = new URL('migrate_free_files.py', import.meta.url);
  assert.equal(await fs.access(migrationTool).then(() => true, () => false), true, 'private PDFs need an offline D1 file importer');
  const folder = 'D:/workspace/codex_list/scratch/free-storage-migration-check';
  await fs.mkdir(folder, { recursive: true });
  const raw = new Uint8Array(1024 * 1024 + 79);
  for (let i = 0; i < raw.length; i++) raw[i] = i % 256;
  raw.set(new TextEncoder().encode('%PDF-1.7\n'));
  await fs.writeFile(folder + '/source.pdf', raw);
  await fs.writeFile(folder + '/manifest.json', JSON.stringify({ files: [{ key: 'users/imported/pdfs/test.pdf', path: folder + '/source.pdf' }, { key: 'published-pdfs/imported.pdf', path: folder + '/source.pdf' }] }));
  execFileSync('C:/Users/rabbit/AppData/Roaming/uv/python/cpython-3.12.14-windows-x86_64-none/python.exe', ['_tools/migrate_free_files.py', folder + '/manifest.json', '--output', folder + '/files.sql'], { env: { ...process.env, TEMP: 'D:/workspace/codex_list/scratch/tmp', TMP: 'D:/workspace/codex_list/scratch/tmp', PYTHONDONTWRITEBYTECODE: '1' } });
  const statements = (await fs.readFile(folder + '/files.sql', 'utf8')).split(';').map(x => x.trim()).filter(Boolean);
  assert.ok(statements.every(statement => new TextEncoder().encode(statement).length < 100000));
  for (let repeat = 0; repeat < 2; repeat++) for (const statement of statements) await db.prepare(statement).run();
  assert.deepEqual(new Uint8Array(await (await ok(await invoke('get', 'users/imported/pdfs/test.pdf'))).arrayBuffer()), raw);
  assert.deepEqual(new Uint8Array(await (await ok(await invoke('get', 'published-pdfs/imported.pdf'))).arrayBuffer()), raw);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM storage_blobs').first()).n, 1, 'public and private imports share the same immutable bytes');
  if (process.argv[2]) {
    const realManifest = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    execFileSync('C:/Users/rabbit/AppData/Roaming/uv/python/cpython-3.12.14-windows-x86_64-none/python.exe', ['_tools/migrate_free_files.py', process.argv[2], '--output', folder + '/actual-files.sql'], { env: { ...process.env, TEMP: 'D:/workspace/codex_list/scratch/tmp', TMP: 'D:/workspace/codex_list/scratch/tmp', PYTHONDONTWRITEBYTECODE: '1' } });
    for (const statement of (await fs.readFile(folder + '/actual-files.sql', 'utf8')).split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
    let count = 0, bytes = 0;
    for (const item of realManifest.files.filter(item => item.key.startsWith('users/') || item.key.startsWith('published-pdfs/'))) {
      const expected = new Uint8Array(await fs.readFile(item.path));
      const result = new Uint8Array(await (await ok(await invoke('get', item.key))).arrayBuffer());
      assert.deepEqual(result, expected);
      count++; bytes += expected.byteLength;
    }
    console.log(`PASS actual private PDF migration: files=${count}, bytes=${bytes}, exact byte equality`);
  }
  console.log('PASS Pages static fragments, private PDF writes, immutable shared snapshot, chunk completion, cross-chunk range and free storage limit');
} finally { await mf.dispose(); }
