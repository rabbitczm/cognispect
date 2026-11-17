export function onRequest() {
  return new Response('资源不存在', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
