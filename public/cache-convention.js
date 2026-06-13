// The offline-cache convention — single source of truth for how the active
// Library is cached for offline reading (see docs/adr/0002). Loaded build-free
// into BOTH execution contexts that need it: the page (`app.js`, via a <script>
// tag) warms and evicts the runtime cache; the service worker (`sw.js`, via
// importScripts) serves requests network-first. Assigning to `self` works in
// both a window and a worker global. The server's `extractMediaKeys`
// (src/media.ts) mirrors the same `/media/<key>` shape in its own runtime.
self.PARSE_CACHE = (() => {
	// Bump SHELL_CACHE on shell changes to bust the precache; RUNTIME_CACHE holds
	// the mirrored Library (Article content + media).
	const SHELL_CACHE = 'parse-shell-v1';
	const RUNTIME_CACHE = 'parse-runtime-v1';

	// Precached app shell, served cache-first. cache-convention.js is itself in
	// the list so the convention is available offline to a freshly-woken SW.
	const SHELL_ASSETS = [
		'/',
		'/index.html',
		'/app.js',
		'/cache-convention.js',
		'/style.css',
		'/manifest.json',
		'/icon.svg',
	];

	// The /media/<key> reference shape, used to discover an Article's images in
	// stored content. Global flag — callers that reuse it must reset lastIndex
	// or build a fresh RegExp; mediaUrls() below is the safe accessor.
	const mediaPattern = () => /\/media\/[A-Za-z0-9._-]+/g;

	// Pull every /media/<key> URL out of stored Article content.
	const mediaUrls = (content) => content.match(mediaPattern()) || [];

	// Is this same-origin GET path one we mirror for offline (Article content or
	// media)? The single predicate both the SW (what to network-first + cache)
	// and the page (what to evict) agree on.
	const isRuntimeCacheable = (path) =>
		path.startsWith('/api/articles') || path.startsWith('/media/');

	return { SHELL_CACHE, RUNTIME_CACHE, SHELL_ASSETS, mediaUrls, isRuntimeCacheable };
})();
