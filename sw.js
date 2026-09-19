// Simple service worker for PWA offline caching
const CACHE = 'pg2-dashboard-v2';
const ASSETS = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './assets/icon.svg', './assets/icon-maskable.svg', './data.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Jangan cache POST/call ke script.google.com (endpoint write)
  const url = new URL(e.request.url);
  if (url.hostname === 'script.google.com') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
