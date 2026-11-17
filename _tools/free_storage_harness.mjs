import { createPrivateStorage } from '../cloud/free-storage.js';
export default { async fetch(request, env) {
  const query = new URL(request.url).searchParams, storage = createPrivateStorage(env, request.url), key = query.get('key');
  try {
    let result;
    switch (query.get('action')) {
      case 'get': {
        const range = query.has('offset') ? { offset: Number(query.get('offset')), length: Number(query.get('length')) } : undefined;
        const object = await storage.get(key, range ? { range } : {});
        if (!object) return new Response('missing', { status: 404 });
        const headers = new Headers(); object.writeHttpMetadata(headers);
        return new Response(object.body, { headers });
      }
      case 'put': result = await storage.put(key, request.body, { httpMetadata: { contentType: query.get('type') } }); break;
      case 'delete': result = await storage.delete(key); break;
      case 'copy': result = await storage.copy(key, query.get('target')); break;
      case 'start': result = await storage.startUpload(key, Number(query.get('total')), query.get('type')); break;
      case 'chunk': result = await storage.putChunk(key, Number(query.get('index')), await request.arrayBuffer()); break;
      case 'complete': result = await storage.completeUpload(key); break;
    }
    return Response.json(result || { ok: true });
  } catch (error) { return Response.json({ error: error.message }, { status: error.status || 400 }); }
} };
