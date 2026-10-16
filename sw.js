const CACHE_NAME = 'okpotani-hardware-firebase-v7';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './firebase-config.js', './firebase-bundle.js', './cloud.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Settings file: always try the network first so an edited firebase-config.js is picked up right away.
  const isConfig = new URL(req.url).pathname.endsWith('/firebase-config.js');
  if (isConfig) {
    event.respondWith(fetch(req).then(resp => {
      if (resp && resp.ok) { const copy = resp.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); }
      return resp;
    }).catch(() => caches.match(req)));
    return;
  }
  event.respondWith(caches.match(req).then(cached => {
    if (cached) return cached;
    return fetch(req).then(response => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return response;
    }).catch(() => {
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw new Error('Offline and resource not cached.');
    });
  }));
});
