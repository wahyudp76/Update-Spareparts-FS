// PG2 Dashboard service worker — network-first with robust cache-busting
const CACHE = 'pg2-dashboard-v4';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg'
];
// data.json TIDAK di-precache: selalu diambil fresh dari jaringan.

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Jangan intercept POST/call ke script.google.com (endpoint write)
  if (url.hostname === 'script.google.com') return;

  // Jangan intercept request ke Google Sheets (export CSV)
  if (url.hostname === 'docs.google.com') return;

  // Request dengan ?t=<timestamp> (cache-bust refresh / auto refresh) →
  // selalu fetch fresh, JANGAN kembalikan cache dulu.
  if (url.searchParams.has('t')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Strategi network-first untuk request lain (stale cache hanya sebagai fallback).
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
