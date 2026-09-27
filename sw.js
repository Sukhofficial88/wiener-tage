// Service worker «Венских дней» (Wiener Tage): приложение целиком хранится на телефоне и работает без сети.
// При любом изменении файлов увеличьте VERSION, иначе телефоны не получат обновление.
const VERSION = "wt-0.7.1";
const FONTS = "wt-fonts";
const AUDIO = "wt-audio";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/data.js",
  "./js/i18n.js",
  "./js/content/ru.js",
  "./js/content/de.js",
  "./js/content/en.js",
  "./js/content/fr.js",
  "./js/content/it.js",
  "./js/content/es.js",
  "./js/geo.js",
  "./js/audio.js",
  "./js/map.js",
  "./js/citymap.js",
  "./data/map/mozart.json",
  "./data/map/beethoven.json",
  "./data/map/klimt.json",
  "./data/map/freud.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./audio/silence.mp3"
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

  // Записи голосов: кэшируем при первом скачивании и отдаём кусками (Range), как требует Safari
  if(url.pathname.includes("/audio/")){
    e.respondWith((async()=>{
      const cache = await caches.open(AUDIO);
      let hit = await caches.match(req.url);
      if(!hit){
        const r = await fetch(req.url);
        if(!(r.ok && r.status === 200)) return r;
        await cache.put(req.url, r.clone());
        hit = r;
      }
      return rangeResponse(req, hit);
    })());
    return;
  }

  // Остальные файлы приложения: сначала кэш
  e.respondWith(caches.match(req).then(hit=>hit || fetch(req).then(r=>{
    if(r.ok){ const copy = r.clone(); caches.open(VERSION).then(c=>c.put(req, copy)); }
    return r;
  })));
});

async function rangeResponse(req, resp){
  const range = req.headers.get("range");
  if(!range) return resp;
  const buf = await resp.arrayBuffer(); const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : size-1;
  if(m && !m[1] && m[2]){ start = Math.max(0, size - +m[2]); end = size-1; }
  end = Math.min(end, size-1);
  if(start > end) return new Response(null, {status:416, headers:{"Content-Range":`bytes */${size}`}});
  return new Response(buf.slice(start, end+1), {status:206, headers:{
    "Content-Type": resp.headers.get("Content-Type") || "audio/mpeg",
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": String(end-start+1),
    "Accept-Ranges": "bytes"
  }});
}
