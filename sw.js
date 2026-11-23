const SHELL_CACHE = 'family-tree-shell-v14';
const DATA_CACHE = 'family-tree-data-v14';
const PHOTO_CACHE = 'family-tree-photos-v14';

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './lib/format.js',
  './lib/graph.js',
  './lib/relationships.js',
  './manifest.webmanifest',
  './icon.svg',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, PHOTO_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (!keep.has(key)) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      )
    ).then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await (request.mode === 'navigate'
      ? fetch(request)
      : fetch(request, { cache: 'no-cache' }));
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.open(SHELL_CACHE);
      const fallback = await shell.match(new URL('./index.html', self.location).href);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/download.zip')) return;

  if (url.pathname.endsWith('/tree.json')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (url.pathname.includes('/photos/') && url.pathname.endsWith('.webp')) {
    event.respondWith(cacheFirst(request, PHOTO_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, SHELL_CACHE));
});
