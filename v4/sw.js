"use strict";
/// <reference lib="webworker" />
// This module is loaded only as a Service Worker, never as a window script.
const serviceWorker = globalThis;
const CACHE_PREFIX = 'dividend-os-' + new URL(serviceWorker.registration.scope).pathname + '-';
const CACHE = CACHE_PREFIX + 'dividend-os-v0.12.26-r87';
const ASSETS = [
    './', './index.html', './styles.css', './styles-refined.css', './manifest.webmanifest', './icon-192.png', './icon-512.png',
    './app.js', './firebase.js', './auth.js', './storage.js', './cloud.js', './backup.js', './hot-update.js', './runtime-config.js', './toss-client.js', './toss-native.js',
    './modules/activity.js', './modules/constants.js', './modules/utils.js', './modules/state.js', './modules/state-decoder.js',
    './modules/income.js', './modules/dividend-analytics.js', './modules/finance.js', './modules/corporate-actions.js', './modules/cloud-api.js', './modules/cloud-contract.js', './modules/backup-history.js', './modules/validation.js', './modules/demo.js', './modules/portfolio.js', './modules/format.js', './modules/views.js', './modules/home-metrics.js', './modules/migration.js', './modules/toss.js'
];
serviceWorker.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => serviceWorker.skipWaiting()));
});
serviceWorker.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => serviceWorker.clients.claim()));
});
serviceWorker.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET')
        return;
    const url = new URL(event.request.url);
    if (url.origin !== serviceWorker.location.origin)
        return;
    // GitHub Pages may retain an older app shell in the HTTP cache after a
    // deploy. Revalidate online first, then retain that response for offline use.
    const freshRequest = new Request(event.request, { cache: 'no-store' });
    event.respondWith(fetch(freshRequest)
        .then(response => {
        if (!response.ok)
            throw new Error('Network response unavailable');
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
    })
        .catch(async () => (await caches.match(event.request)) || (await caches.match(url.pathname)) || (event.request.mode === 'navigate' ? (await caches.match('./index.html')) || Response.error() : Response.error())));
});
