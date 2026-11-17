export const CHUNK_SIZE = 1024 * 1024;
export const MAX_FILE_BYTES = 30 * CHUNK_SIZE;
const FREE_STORAGE_BYTES = 500 * CHUNK_SIZE;
const manifestCache = new WeakMap();
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const isStatic = key => key.startsWith('runtime/') || key.startsWith('assets/anatomy/');
const isDynamic = key => key.startsWith('users/') || key.startsWith('published-pdfs/');
function contentType(options) { return options?.httpMetadata?.contentType || 'application/octet-stream'; }
function dataBytes(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(value || []);
}
function selectedRange(size, range) {
  const offset = range?.offset ?? 0;
  const length = range?.length ?? size - offset;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || offset > size) throw failure('文件读取范围无效', 416);
  return { offset, length: Math.min(length, size - offset) };
}
function objectValue(size, type, stream, range) {
  const response = new Response(stream, { headers: { 'content-type': type } });
  return {
    size, body: response.body, range, httpMetadata: { contentType: type },
    arrayBuffer: () => response.arrayBuffer(), text: () => response.text(), json: () => response.json(),
    writeHttpMetadata(headers) { headers.set('content-type', type); },
  };
}
function streamFrom(iterator) {
  return new ReadableStream({
    async pull(controller) {
      try { const item = await iterator.next(); if (item.done) controller.close(); else controller.enqueue(item.value); }
      catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return?.(); },
  });
}
export function createPrivateStorage(env, origin = 'https://cognispect.tech') {
  const base = new URL(origin).origin, db = env.DB;
  const query = (statement, ...params) => db.prepare(statement).bind(...params);
  const safeWrite = async work => {
    try { return await work(); }
    catch (error) {
      if (/database.*(?:full|size)|disk is full|SQLITE_FULL|storage.*limit/i.test(error.message || '')) throw failure('免费数据库存储已满，请联系站主清理文件后重试。', 507);
      throw error;
    }
  };
  const requireDynamic = key => { if (typeof key !== 'string' || !isDynamic(key)) throw failure('该文件路径不可写入'); };
  const cleanBlob = async id => {
    if (!id) return;
    await query('DELETE FROM storage_blobs WHERE id=? AND NOT EXISTS(SELECT 1 FROM storage_objects WHERE blob_id=?) AND NOT EXISTS(SELECT 1 FROM storage_uploads WHERE blob_id=?)', id, id, id).run();
  };
  const manifest = async () => {
    let origins = manifestCache.get(env.ASSETS);
    if (!origins) { origins = new Map(); manifestCache.set(env.ASSETS, origins); }
    if (!origins.has(base)) origins.set(base, env.ASSETS.fetch(new Request(base + '/__private_assets/manifest.json')).then(response => {
      if (!response.ok) throw failure('网页资源目录暂未部署，请刷新后重试。', 503);
      return response.json();
    }).catch(error => { origins.delete(base); throw error; }));
    return origins.get(base);
  };
  async function staticGet(key, options) {
    const entry = (await manifest()).objects?.[key];
    if (!entry) return null;
    const range = selectedRange(entry.bytes, options?.range);
    async function* read() {
      let position = 0, remaining = range.length, start = range.offset;
      for (let index = 0; index < entry.parts.length && remaining; index++) {
        const partSize = entry.partBytes?.[index] ?? entry.bytes;
        if (position + partSize <= start) { position += partSize; continue; }
        const localStart = Math.max(0, start - position), count = Math.min(partSize - localStart, remaining);
        const response = await env.ASSETS.fetch(new Request(new URL(entry.parts[index], base), { headers: { range: `bytes=${localStart}-${localStart + count - 1}` } }));
        if (!response.ok) throw failure('网页资源暂未完整部署，请刷新后重试。', 503);
        if (response.status === 206 || (localStart === 0 && count === partSize)) {
          const reader = response.body.getReader();
          try { while (true) { const value = await reader.read(); if (value.done) break; yield value.value; } }
          finally { reader.releaseLock(); }
        } else {
          const bytes = new Uint8Array(await response.arrayBuffer());
          yield bytes.subarray(localStart, localStart + count);
        }
        remaining -= count; position += partSize;
      }
    }
    return objectValue(entry.bytes, entry.contentType || 'application/octet-stream', streamFrom(read()), range);
  }
  const storage = {
    async get(key, options = {}) {
      if (typeof key !== 'string') return null;
      if (isStatic(key)) return staticGet(key, options);
      if (!isDynamic(key)) return null;
      const blob = await query('SELECT b.id,b.size,b.content_type FROM storage_objects o JOIN storage_blobs b ON b.id=o.blob_id WHERE o.object_key=? AND b.complete=1', key).first();
      if (!blob) return null;
      const range = selectedRange(blob.size, options.range);
      async function* read() {
        let offset = range.offset, remaining = range.length;
        while (remaining) {
          const index = Math.floor(offset / CHUNK_SIZE), start = offset % CHUNK_SIZE;
          const chunk = await query('SELECT data FROM storage_chunks WHERE blob_id=? AND chunk_index=?', blob.id, index).first();
          if (!chunk) throw failure('文件分片缺失，请重新上传。', 503);
          const bytes = dataBytes(chunk.data), count = Math.min(remaining, bytes.byteLength - start);
          if (!count) throw failure('文件分片不完整，请重新上传。', 503);
          yield bytes.subarray(start, start + count);
          offset += count; remaining -= count;
        }
      }
      return objectValue(blob.size, blob.content_type, streamFrom(read()), range);
    },
    async startUpload(key, total, type = 'application/pdf') {
      requireDynamic(key);
      if (!Number.isSafeInteger(total) || total < 0) throw failure('文件大小无效');
      if (total > MAX_FILE_BYTES) throw failure('PDF 超过 30 MiB 上传限制', 413);
      const id = crypto.randomUUID(), old = await query('SELECT blob_id FROM storage_uploads WHERE object_key=?', key).first();
      if (old) { await query('DELETE FROM storage_uploads WHERE object_key=?', key).run(); await cleanBlob(old.blob_id); }
      const result = await safeWrite(() => query('INSERT INTO storage_blobs(id,size,content_type,complete,created) SELECT ?,?,?,0,? WHERE (SELECT COALESCE(SUM(size),0) FROM storage_blobs)+?<=?', id, total, type, Date.now(), total, FREE_STORAGE_BYTES).run());
      if (!result.meta.changes) throw failure('免费数据库存储空间不足，请联系站主清理文件后重试。', 507);
      await query('INSERT INTO storage_uploads(object_key,blob_id) VALUES(?,?)', key, id).run();
      return { key, uploadId: id, chunkSize: CHUNK_SIZE, chunks: Math.ceil(total / CHUNK_SIZE), total };
    },
    async putChunk(key, index, input) {
      requireDynamic(key);
      const blob = await query('SELECT b.id,b.size FROM storage_uploads u JOIN storage_blobs b ON b.id=u.blob_id WHERE u.object_key=? AND b.complete=0', key).first();
      if (!blob) throw failure('上传任务不存在，请重新选择 PDF。', 404);
      const bytes = dataBytes(input), count = Math.ceil(blob.size / CHUNK_SIZE);
      if (!Number.isInteger(index) || index < 0 || index >= count || bytes.byteLength !== Math.min(CHUNK_SIZE, blob.size - index * CHUNK_SIZE)) throw failure('PDF 分片大小或序号不正确');
      await safeWrite(() => query('INSERT OR REPLACE INTO storage_chunks(blob_id,chunk_index,data) VALUES(?,?,?)', blob.id, index, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).run());
      return { key, index, bytes: bytes.byteLength };
    },
    async completeUpload(key) {
      requireDynamic(key);
      const blob = await query('SELECT b.id,b.size FROM storage_uploads u JOIN storage_blobs b ON b.id=u.blob_id WHERE u.object_key=?', key).first();
      if (!blob) {
        const completed = await query('SELECT b.size FROM storage_objects o JOIN storage_blobs b ON b.id=o.blob_id WHERE o.object_key=? AND b.complete=1', key).first();
        if (completed) return { key, size: completed.size };
        throw failure('上传任务不存在，请重新选择 PDF。', 404);
      }
      const stats = await query('SELECT COUNT(*) n,COALESCE(SUM(length(data)),0) bytes FROM storage_chunks WHERE blob_id=?', blob.id).first();
      if (stats.n !== Math.ceil(blob.size / CHUNK_SIZE) || stats.bytes !== blob.size) throw failure('PDF 尚未上传完整，请继续上传剩余分片。', 409);
      const old = await query('SELECT blob_id FROM storage_objects WHERE object_key=?', key).first();
      await safeWrite(() => db.batch([
        query('UPDATE storage_blobs SET complete=1 WHERE id=?', blob.id),
        query('INSERT OR REPLACE INTO storage_objects(object_key,blob_id) VALUES(?,?)', key, blob.id),
        query('DELETE FROM storage_uploads WHERE object_key=? AND blob_id=?', key, blob.id),
      ]));
      if (old) await cleanBlob(old.blob_id);
      return { key, size: blob.size };
    },
    async put(key, value, options = {}) {
      const bytes = value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer()) : dataBytes(value);
      const upload = await storage.startUpload(key, bytes.byteLength, contentType(options));
      for (let index = 0; index * CHUNK_SIZE < bytes.byteLength; index++) {
        const chunk = bytes.subarray(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
        await safeWrite(() => query('INSERT INTO storage_chunks(blob_id,chunk_index,data) VALUES(?,?,?)', upload.uploadId, index, chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)).run());
      }
      return storage.completeUpload(key);
    },
    async copy(source, target) {
      requireDynamic(source); requireDynamic(target);
      const file = await query('SELECT o.blob_id FROM storage_objects o JOIN storage_blobs b ON b.id=o.blob_id WHERE o.object_key=? AND b.complete=1', source).first();
      if (!file) throw failure('原 PDF 已不存在，无法公开。', 404);
      const old = await query('SELECT blob_id FROM storage_objects WHERE object_key=?', target).first();
      await query('INSERT OR REPLACE INTO storage_objects(object_key,blob_id) VALUES(?,?)', target, file.blob_id).run();
      if (old) await cleanBlob(old.blob_id);
      return { key: target };
    },
    async delete(key) {
      requireDynamic(key);
      const objects = await db.batch([query('SELECT blob_id FROM storage_objects WHERE object_key=?', key), query('SELECT blob_id FROM storage_uploads WHERE object_key=?', key)]);
      await db.batch([query('DELETE FROM storage_objects WHERE object_key=?', key), query('DELETE FROM storage_uploads WHERE object_key=?', key)]);
      for (const id of new Set(objects.flatMap(result => result.results || []).map(row => row.blob_id))) await cleanBlob(id);
    },
  };
  return storage;
}
