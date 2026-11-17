export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let page;
  if (['/admin', '/admin/', '/admin.html'].includes(url.pathname)) page = 'admin';
  else if (['/intro', '/intro/', '/intro.html'].includes(url.pathname)) page = 'intro';
  else if (url.pathname === '/index.html' || url.pathname === '/') page = 'main';
  else return env.ASSETS.fetch(request);
  const response = await env.ASSETS.fetch(new Request(new URL('/__private_assets/site/' + page + '.bin', url)));
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}
