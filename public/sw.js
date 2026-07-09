/* Job Hunter service worker.
   Goal: make the app installable and resilient — the shell loads instantly and
   works offline, while live data always comes from the network.

   Strategy:
   - Precache the static shell on install.
   - Network-first for everything else GET, falling back to cache when offline
     (so a new deploy is picked up as soon as you're online, no stale UI).
   - API requests (/api/*) and non-GET are never cached — they're per-user,
     authenticated, and change constantly. They pass straight through.

   Bump CACHE when the shell file list changes to evict the old precache. */

const CACHE = 'jh-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/ui.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (fonts) pass
  if (url.pathname.startsWith('/api/')) return; // never cache API/auth traffic

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache a copy of good same-origin responses for offline use.
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        // Offline: serve the cached asset, or the app shell for navigations.
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/');
        return Response.error();
      }),
  );
});
