const CACHE = 'dividend-os-v0.9';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './app.js', './firebase.js', './auth.js', './storage.js', './cloud.js', './backup.js',
  './modules/constants.js', './modules/utils.js', './modules/state.js',
  './modules/portfolio.js', './modules/format.js', './modules/views.js'
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
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
