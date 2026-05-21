// Minimal service worker: cache the app shell so termo opens offline.
// The print SDK is loaded from a CDN and needs network on first run.
const CACHE = 'termo-v10';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // CDN requests go straight to the network
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
