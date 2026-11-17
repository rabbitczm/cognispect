const VERSION='__ZHIJING_SHELL_VERSION__',CACHE='zhijing-shell-'+VERSION;
self.addEventListener('install',event=>event.waitUntil((async()=>{const response=await fetch('/',{cache:'reload'});if(response.ok)await(await caches.open(CACHE)).put('/',response);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('zhijing-shell-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 const shell=(url.pathname==='/'||url.pathname==='/index.html')&&!url.searchParams.has('preview');
 const asset=url.pathname.startsWith('/assets/app/')||url.pathname.startsWith('/assets/runtime/');
 if(!shell&&!asset)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),key=shell?new Request(url.origin+'/'):request,cached=await cache.match(key);
  const update=async()=>{const response=await fetch(request);if(response.ok)await cache.put(key,response.clone());return response;};
  if(cached){if(shell)event.waitUntil(update().catch(()=>{}));return cached;}return update();
 })());
});
