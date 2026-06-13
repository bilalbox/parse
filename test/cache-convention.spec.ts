import { describe, it, expect, beforeAll } from 'vitest';

// cache-convention.js isn't a module — it assigns self.PARSE_CACHE. Import it
// for its side effect (self exists in the workers pool), then read the global.
import '../public/cache-convention.js';
const PARSE_CACHE = (globalThis as any).PARSE_CACHE;

beforeAll(() => {
	expect(PARSE_CACHE, 'cache-convention.js must populate self.PARSE_CACHE').toBeDefined();
});

describe('offline-cache convention', () => {
	it('treats Article content and media as runtime-cacheable, nothing else', () => {
		const { isRuntimeCacheable } = PARSE_CACHE;
		expect(isRuntimeCacheable('/api/articles')).toBe(true);      // the library list
		expect(isRuntimeCacheable('/api/articles/abc')).toBe(true);  // one Article
		expect(isRuntimeCacheable('/media/x_1.png')).toBe(true);
		expect(isRuntimeCacheable('/api/search')).toBe(false);
		expect(isRuntimeCacheable('/api/queue')).toBe(false);
	});

	it('extracts deduped /media/<key> URLs from stored content', () => {
		const { mediaUrls } = PARSE_CACHE;
		expect(mediaUrls('<img src="/media/a.png"> text <img src="/media/b.jpg">'))
			.toEqual(['/media/a.png', '/media/b.jpg']);
		expect(mediaUrls('no media here')).toEqual([]);
	});

	// The eviction rule lives in app.js warmOfflineCache, but it is exactly
	// `isRuntimeCacheable(path) && !keep.has(path)`. This locks the load-bearing
	// distinction: the bare library list survives, a stale per-Article entry does
	// not — the regression that a single-predicate refactor nearly introduced.
	it('evicts stale per-Article entries while preserving the library list', () => {
		const { isRuntimeCacheable, SHELL_ASSETS } = PARSE_CACHE;
		const keep = new Set([...SHELL_ASSETS, '/api/articles', '/api/articles/live', '/media/live.png']);
		const evicts = (path: string) => isRuntimeCacheable(path) && !keep.has(path);

		expect(evicts('/api/articles')).toBe(false);        // list: cacheable, always kept
		expect(evicts('/api/articles/live')).toBe(false);   // still in the library
		expect(evicts('/media/live.png')).toBe(false);
		expect(evicts('/api/articles/stale')).toBe(true);   // left the library → evict
		expect(evicts('/media/stale.png')).toBe(true);
		expect(evicts('/api/search')).toBe(false);          // never runtime-cached
	});
});
