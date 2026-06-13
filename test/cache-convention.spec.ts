import { describe, it, expect } from 'vitest';
import { isRuntimeCacheable, mediaUrls } from '../src/lib/cache-convention';

describe('offline-cache convention', () => {
	it('treats Article content and media as runtime-cacheable, nothing else', () => {
		expect(isRuntimeCacheable('/api/articles')).toBe(true);      // the library list
		expect(isRuntimeCacheable('/api/articles/abc')).toBe(true);  // one Article
		expect(isRuntimeCacheable('/media/x_1.png')).toBe(true);
		expect(isRuntimeCacheable('/api/search')).toBe(false);
		expect(isRuntimeCacheable('/api/queue')).toBe(false);
	});

	it('extracts deduped /media/<key> URLs from stored content', () => {
		expect(mediaUrls('<img src="/media/a.png"> text <img src="/media/b.jpg">'))
			.toEqual(['/media/a.png', '/media/b.jpg']);
		expect(mediaUrls('no media here')).toEqual([]);
	});

	// The eviction rule lives in Svelte warmOfflineCache, but it is exactly
	// `isRuntimeCacheable(path) && !keep.has(path)`. This locks the load-bearing
	// distinction: the bare library list survives, a stale per-Article entry does
	// not.
	it('evicts stale per-Article entries while preserving the library list', () => {
		const shellAssets = ['/', '/index.html', '/manifest.json'];
		const keep = new Set([...shellAssets, '/api/articles', '/api/articles/live', '/media/live.png']);
		const evicts = (path: string) => isRuntimeCacheable(path) && !keep.has(path);

		expect(evicts('/api/articles')).toBe(false);        // list: cacheable, always kept
		expect(evicts('/api/articles/live')).toBe(false);   // still in the library
		expect(evicts('/media/live.png')).toBe(false);
		expect(evicts('/api/articles/stale')).toBe(true);   // left the library → evict
		expect(evicts('/media/stale.png')).toBe(true);
		expect(evicts('/api/search')).toBe(false);          // never runtime-cached
	});
});
