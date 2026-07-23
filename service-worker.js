'use strict';

const CACHE_NAME='vastgoed-dashboard-static-v38-1';
const OFFLINE_URL='/offline.html';
const STATIC_ASSETS=[
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  OFFLINE_URL,
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;

  const url=new URL(request.url);

  // Externe diensten en API-verzoeken worden nooit door deze service worker
  // opgeslagen of onderschept. Dit geldt dus ook voor Supabase en CBS.
  if(url.origin!==self.location.origin) return;

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        return await fetch(request,{cache:'no-store'});
      }catch(error){
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  if(!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith((async()=>{
    const cached=await caches.match(request,{ignoreSearch:true});
    if(cached) return cached;
    const response=await fetch(request);
    if(response.ok){
      const cache=await caches.open(CACHE_NAME);
      await cache.put(request,response.clone());
    }
    return response;
  })());
});
