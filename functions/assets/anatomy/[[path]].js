import worker from '../../../cloud/worker.js';
import { createPrivateStorage } from '../../../cloud/free-storage.js';
import { BUILD_VERSION } from '../../../cloud/build-version.js';

export async function onRequest({ env, params, request, waitUntil }) {
  env = { ...env, PRIVATE: createPrivateStorage(env, new URL(request.url).origin) };
  const settings = await env.DB.prepare("SELECT published FROM site_settings WHERE id=1").first();
  if (settings && JSON.parse(settings.published).modules?.find(x => x.id === 'anatomy')?.visible === false) {
    const sessionResponse = await worker.fetch(new Request(new URL('/api/auth/session', request.url), { headers: request.headers }), env);
    if ((await sessionResponse.json()).user?.role !== 'owner') return new Response('资源未公开', { status: 404 });
  }
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!path || path.includes('..')) return new Response('资源不存在', { status: 404 });
  const cacheKey=new Request(new URL('/__edge_assets/'+BUILD_VERSION+'/'+path,request.url));
  const cached=await caches.default.match(cacheKey);
  if(cached){const headers=new Headers(cached.headers);headers.set('Cache-Control','no-store');return new Response(cached.body,{headers});}
  const object = await env.PRIVATE.get('assets/anatomy/' + path);
  if (!object) return new Response('资源不存在', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
  const response=new Response(object.body,{headers});
  const shared=response.clone(),sharedHeaders=new Headers(headers);sharedHeaders.set('Cache-Control','public, max-age=31536000');
  waitUntil(caches.default.put(cacheKey,new Response(shared.body,{headers:sharedHeaders})));
  return response;
}
