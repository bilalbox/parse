import { describe, it, expect } from 'vitest';
import { extractArticle, Source } from '../src/extract';

// A fake R2 bucket that records puts instead of hitting the network.
function fakeBucket() {
	const puts: { key: string; contentType?: string }[] = [];
	return {
		puts,
		async put(key: string, _body: unknown, opts?: any) {
			puts.push({ key, contentType: opts?.httpMetadata?.contentType });
			return undefined;
		},
	};
}

const PARA = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. '.repeat(6) + '</p>';
const FIXTURE_HTML = `<!doctype html><html><head><title>Fixture Page</title></head><body>
	<article>
		<h1>Fixture Title</h1>
		${PARA}${PARA}
		<img src="https://example.com/hero.png">
		${PARA}${PARA}
	</article>
</body></html>`;

// A minimal Source standing in for WebSource/EmailSource — proves the spine's
// contract (rescue hook runs, images flow through resolveBytes → bucket, the
// img src is rewritten, metadata is applied) with no browser and no email.
function fakeSource(overrides: Partial<Source> = {}): Source {
	return {
		html: FIXTURE_HTML,
		baseUrl: 'https://example.com/post',
		async resolveBytes() {
			return { buffer: new ArrayBuffer(8), contentType: 'image/png' };
		},
		rescue({ articleDoc }) {
			const marker = articleDoc.createElement('p');
			marker.textContent = 'RESCUED_MARKER';
			(articleDoc.body || articleDoc.documentElement).appendChild(marker);
		},
		metadata(article: any) {
			return {
				title: article.title || 'Untitled',
				author: article.byline || 'Unknown',
				url: 'https://example.com/post',
				sourceType: 'web',
				unsubscribeLink: null,
				unsubscribeOneClick: false,
				published: null,
				wordCount: null,
			};
		},
		...overrides,
	};
}

describe('extraction spine', () => {
	it('runs the Source rescue hook against the parsed article', async () => {
		const article = await extractArticle(fakeSource(), fakeBucket() as any);
		expect(article.content).toContain('RESCUED_MARKER');
	});

	it('uploads resolved images to R2 and rewrites their src to /media/<key>', async () => {
		const bucket = fakeBucket();
		const article = await extractArticle(fakeSource(), bucket as any);

		expect(bucket.puts).toHaveLength(1);
		expect(bucket.puts[0].contentType).toBe('image/png');
		expect(article.content).toContain('/media/');
		expect(article.content).not.toContain('https://example.com/hero.png');
	});

	it('skips upload and leaves the src untouched when bytes cannot be resolved', async () => {
		const bucket = fakeBucket();
		const article = await extractArticle(fakeSource({ async resolveBytes() { return null; } }), bucket as any);

		expect(bucket.puts).toHaveLength(0);
		expect(article.content).toContain('https://example.com/hero.png');
	});

	it('derives Article fields from the Source metadata', async () => {
		const article = await extractArticle(fakeSource(), fakeBucket() as any);

		expect(article.id).toMatch(/[0-9a-f-]{36}/i);
		expect(article.sourceType).toBe('web');
		expect(article.url).toBe('https://example.com/post');
		expect(article.unsubscribeOneClick).toBe(false);
		// content is the Readability result as JSON, with rewritten inner HTML
		expect(() => JSON.parse(article.content)).not.toThrow();
	});
});
