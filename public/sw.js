/*
 * Service worker de la PWA (Control Financiero).
 *
 * Mínimo y conservador: los datos financieros NUNCA se cachean (son por
 * usuario y por empresa, y viejos engañan). Solo:
 *  · navegación: red primero; sin red → /offline.html.
 *  · /_next/static/*: cache-first (archivos inmutables con hash).
 *  · íconos y la página offline: precache.
 * Todo lo demás (API, server actions, POST, RSC) pasa directo a la red.
 */
const VERSION = 'cf-pwa-v1';
const PRECACHE = ['/offline.html', '/pwa/icon-192.png', '/pwa/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copia));
        }
        return res;
      })),
    );
  }
});
