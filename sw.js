// Service worker «Венских дней»: приложение целиком хранится на телефоне и работает без сети.
// При любом изменении файлов увеличьте VERSION, иначе телефоны не получат обновление.
const VERSION = "wt-0.2.0";
const FONTS = "wt-fonts";
const AUDIO = "wt-audio";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/data.js",
  "./js/geo.js",
  "./js/audio.js",
  "./js/map.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)));
});

self.addEventListener("activate", e=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("wt-") && ![VERSION, FONTS, AUDIO].includes(k)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e=>{ if(e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // Шрифты Google: отдаём из кэша, в фоне обновляем
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith((async()=>{
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then(r=>{ if(r.ok || r.type === "opaque") cache.put(req, r.clone()); return r; }).catch(()=>hit);
      return hit || net;
    })());
    return;
  }
  if(url.origin !== self.location.origin) return;

  // Переходы по страницам: оболочка приложения из кэша
  if(req.mode === "navigate"){
    e.respondWith(caches.match("./index.html").then(hit=>hit || fetch(req)));
    return;
  }

  // Записи голосов (появятся позже): кэшируем при первом прослушивании
  if(url.pathname.includes("/audio/")){
    e.respondWith((async()=>{
      const cache = await caches.open(AUDIO);
      const hit = await cache.match(req.url);
      if(hit) return hit;
      const r = await fetch(req);
      if(r.ok && r.status === 200) cache.put(req.url, r.clone());
      return r;
    })());
    return;
  }

  // Остальные файлы приложения: сначала кэш
  e.respondWith(caches.match(req).then(hit=>hit || fetch(req).then(r=>{
    if(r.ok){ const copy = r.clone(); caches.open(VERSION).then(c=>c.put(req, copy)); }
    return r;
  })));
});
