const CACHE_NAME = 'okpotani-hardware-firebase-v12';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './firebase-config.js', './firebase-bundle.js', './cloud.js', './subscription.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Settings file: always try the network first so an edited firebase-config.js is picked up right away.
  // App files that change often (and the page itself): ask the network first and revalidate, so an update appears on the next
  // open when online. They still work offline from the saved copy. Big static files (firebase-bundle.js, icons) stay cache-first.
  const path = new URL(req.url).pathname;
  const isFresh = req.mode === 'navigate' || /(\/|\/index\.html|\/cloud\.js|\/subscription\.js|\/manifest\.webmanifest)$/.test(path);
  if (isFresh) {
    event.respondWith(fetch(req, { cache: 'no-cache' }).then(resp => {
      if (resp && resp.ok && resp.type === 'basic') { const copy = resp.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); }
      return resp;
    }).catch(() => caches.match(req).then(c => c || caches.match('./index.html'))));
    return;
  }
  const isConfig = path.endsWith('/firebase-config.js');
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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    if (list.length) return list[0].focus();
    return self.clients.openWindow('./');
  }));
});
