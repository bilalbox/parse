import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractMediaKeys, rescueMedia, serveMedia } from '../src/media';

function fakeBucket(stored: Record<string, unknown> = {}) {
	const puts: { key: string }[] = [];
	return {
		puts,
		async put(key: string) {
			puts.push({ key });
		},
		async get(key: string) {
			if (!(key in stored)) return null;
			return {
				body: 'bytes',
				httpEtag: '"etag"',
				writeHttpMetadata(h: Headers) {
					h.set('Content-Type', 'image/png');
				},
			};
		},
	};
}

describe('media convention', () => {
	it('extractMediaKeys pulls deduped keys back out of stored content', () => {
		const content = 'a <img src="/media/abc.png"> b <img src="/media/abc.png"> c /media/def.jpg';
		expect(extractMediaKeys(content).sort()).toEqual(['abc.png', 'def.jpg']);
		expect(extractMediaKeys(null)).toEqual([]);
	});

	it('rescueMedia uploads resolvable images and rewrites them to /media/<key>', async () => {
		const { document } = parseHTML('<body><img src="https://x/a.png"><img src="https://x/b.png"></body>');
		const bucket = fakeBucket();

		// Resolve only the first image; the second stays as-is.
		await rescueMedia(
			document,
			async (src: string) => (src.endsWith('a.png') ? { buffer: new ArrayBuffer(4), contentType: 'image/png' } : null),
			bucket as any,
		);

		expect(bucket.puts).toHaveLength(1);
		const html = document.toString();
		expect(html).toMatch(/\/media\/[A-Za-z0-9._-]+/);
		expect(html).toContain('https://x/b.png');
	});

	it('serveMedia returns a cached Response on hit and null on miss', async () => {
		const bucket = fakeBucket({ 'abc.png': true });
		const hit = await serveMedia(bucket as any, 'abc.png');
		expect(hit).toBeInstanceOf(Response);
		expect(hit!.headers.get('Cache-Control')).toContain('max-age=31536000');

		const miss = await serveMedia(bucket as any, 'nope.png');
		expect(miss).toBeNull();
	});
});
