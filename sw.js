const CACHE = 'dividend-os-v0.9.10-r32';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './app.js', './firebase.js', './auth.js', './storage.js', './cloud.js', './backup.js', './runtime-config.js', './toss-client.js',
  './modules/constants.js', './modules/utils.js', './modules/state.js',
  './modules/portfolio.js', './modules/format.js', './modules/views.js', './modules/home-metrics.js', './modules/migration.js', './modules/toss.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // GitHub Pages may retain an older app shell in the HTTP cache after a
  // deploy. Revalidate online first, then retain that response for offline use.
  const freshRequest = new Request(event.request, { cache: 'no-store' });
  event.respondWith(
    fetch(freshRequest)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
