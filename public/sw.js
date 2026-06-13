// Offline-first service worker (see docs/adr/0002).
//
// - The app shell is precached on install and served cache-first.
// - Article content (GET /api/articles*) and media (GET /media/*) use
//   network-first with a cache fallback, so they're fresh online and available
//   offline. The page (app.js) proactively warms and prunes the runtime cache
//   to mirror the active library.
// - Everything else (writes, search, queue) is network-only and never cached.
//
// The cache names, shell list, and what-counts-as-cacheable rules are NOT
// defined here — they're the offline-cache convention, shared build-free with
// the page via cache-convention.js (self.PARSE_CACHE).
// NB: importScripts byte-caches this file into the SW registration at install,
// so editing cache-convention.js alone won't reach the SW — bump SHELL_CACHE
// (or touch this file) to force the SW to re-install with the new convention.
importScripts('/cache-convention.js');

const { SHELL_CACHE, RUNTIME_CACHE, SHELL_ASSETS, isRuntimeCacheable } = self.PARSE_CACHE;

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(n => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
                    .map(n => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

// Try the network, fall back to cache; cache successful GET responses.
async function networkFirst(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

self.addEventListener('fetch', (e) => {
    const { request } = e;
    if (request.method !== 'GET') return; // writes go straight to the network

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // SPA navigations: serve the cached shell when the network is unavailable.
    if (request.mode === 'navigate') {
        e.respondWith(
            fetch(request).catch(() => caches.match('/index.html'))
        );
        return;
    }

    // Article content and media: network-first with cache fallback for offline.
    if (isRuntimeCacheable(url.pathname)) {
        e.respondWith(networkFirst(request));
        return;
    }

    // App shell assets: cache-first.
    if (SHELL_ASSETS.includes(url.pathname)) {
        e.respondWith(caches.match(request).then(c => c || fetch(request)));
        return;
    }

    // Everything else: default browser handling.
});
