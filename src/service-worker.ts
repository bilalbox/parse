/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { RUNTIME_CACHE, isRuntimeCacheable } from './lib/cache-convention';

const SHELL_CACHE = `parse-shell-${version}`;
const SHELL_ASSETS = [
	'/',
	...build,
	...files
];

// Helper to cast self to ServiceWorkerGlobalScope
const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(
		caches.open(SHELL_CACHE)
			.then(cache => cache.addAll(SHELL_ASSETS))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		caches.keys()
			.then(names => Promise.all(
				names
					.filter(n => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
					.map(n => caches.delete(n))
			))
			.then(() => sw.clients.claim())
	);
});

async function networkFirst(request: Request) {
	const cache = await caches.open(RUNTIME_CACHE);
	try {
		const response = await fetch(request);
		if (response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	} catch (err) {
		const cached = await cache.match(request);
		if (cached) return cached;
		throw err;
	}
}

sw.addEventListener('fetch', (event: FetchEvent) => {
	const { request } = event;
	if (request.method !== 'GET') return; // writes go straight to the network

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// SPA navigations: serve the cached shell when the network is unavailable.
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(() => caches.match('/index.html') as Promise<Response>)
		);
		return;
	}

	// Article content and media: network-first with cache fallback for offline.
	if (isRuntimeCacheable(url.pathname)) {
		event.respondWith(networkFirst(request));
		return;
	}

	// App shell assets: cache-first.
	if (SHELL_ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches.match(request).then(c => c || fetch(request))
		);
		return;
	}
});
