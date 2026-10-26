import puppeteer from '@cloudflare/puppeteer';
import Defuddle from 'defuddle';
import { type Source, extractFeaturedImage } from '../extract';
import { FEATURED_IMAGE_CLASS } from '../lib/rescue';

// The web ingest adapter. Renders the page with Puppeteer up front (the one
// untestable step, kept thin and isolated), then satisfies the Source seam:
// images resolve by fetch, rescue re-attaches the featured image, metadata
// comes from Readability plus the originating URL.
export async function createWebSource(url: string, browserBinding: Parameters<typeof puppeteer.launch>[0]): Promise<Source> {
	const browser = await puppeteer.launch(browserBinding);
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

	// Trigger IntersectionObserver for below-the-fold images & screenshots
	try {
		await page.evaluate(async () => {
			window.scrollBy(0, document.body.scrollHeight / 2);
			await new Promise((r) => setTimeout(r, 200));
			window.scrollTo(0, 0);
		});
	} catch {
		// Ignore page evaluation errors on restricted or fast-closing contexts
	}

	const html = await page.content();
	await browser.close();

	return {
		html,
		baseUrl: url,

		async resolveBytes(src) {
			const absoluteUrl = new URL(src, url).href;
			const res = await fetch(absoluteUrl);
			if (!res.ok) return null;
			return {
				buffer: await res.arrayBuffer(),
				contentType: res.headers.get('content-type') || 'application/octet-stream',
			};
		},

		// Readability often drops the hero/featured image; re-insert it at the
		// top of the Article if no surviving <img> already points at it.
		rescue({ articleDoc, sourceDoc, baseUrl }) {
			const featuredImageUrl = extractFeaturedImage(sourceDoc, baseUrl);
			if (!featuredImageUrl) return;

			const imgs = Array.from(articleDoc.querySelectorAll('img')) as any[];
			const hasFeatured = imgs.some((img) => {
				const src = img.getAttribute('src') || '';
				return src === featuredImageUrl || src.includes(featuredImageUrl) || featuredImageUrl.includes(src);
			});
			if (hasFeatured) return;

			const fig = articleDoc.createElement('figure');
			fig.setAttribute('class', FEATURED_IMAGE_CLASS);
			const img = articleDoc.createElement('img');
			img.setAttribute('src', featuredImageUrl);
			fig.appendChild(img);
			// Not articleDoc.body: linkedom parses a bodyless fragment (Readability's
			// output) by inserting an always-empty phantom <body>, so it's never a
			// useful insertion point here.
			articleDoc.documentElement.insertBefore(fig, articleDoc.documentElement.firstChild);
		},

		// Readability's byline is often a mangled blob (author + date + tags run
		// together) and it has no publish date. Defuddle extracts clean structured
		// metadata (JSON-LD / meta / byline detection) from the same page, so we
		// use it for title/author/published/wordCount — Readability still owns
		// content, whose images Defuddle prunes too aggressively for our media
		// pipeline. Runs on the disposable post-rescue sourceDoc (Defuddle's parse
		// is destructive); the ESM core avoids defuddle/node's CJS bundle, which
		// breaks the workers runtime. Falls back to Readability's values on error.
		metadata(article, sourceDoc) {
			let d: { title?: string; author?: string; published?: string; wordCount?: number } = {};
			try {
				d = new Defuddle(sourceDoc, { url, markdown: false }).parse();
			} catch (err) {
				console.error('Defuddle metadata failed:', url, err);
			}
			return {
				title: d.title || article.title || 'Untitled',
				author: d.author || article.byline || 'Unknown',
				url,
				sourceType: 'web',
				unsubscribeLink: null,
				unsubscribeOneClick: false,
				published: d.published || null,
				wordCount: d.wordCount ?? null,
			};
		},
	};
}
