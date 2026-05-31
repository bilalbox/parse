import puppeteer from '@cloudflare/puppeteer';
import { Source, extractFeaturedImage } from '../extract';

// The web ingest adapter. Renders the page with Puppeteer up front (the one
// untestable step, kept thin and isolated), then satisfies the Source seam:
// images resolve by fetch, rescue re-attaches the featured image, metadata
// comes from Readability plus the originating URL.
export async function createWebSource(url: string, browserBinding: Parameters<typeof puppeteer.launch>[0]): Promise<Source> {
	const browser = await puppeteer.launch(browserBinding);
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
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
			fig.setAttribute('class', 'featured-image-container');
			const img = articleDoc.createElement('img');
			img.setAttribute('src', featuredImageUrl);
			fig.appendChild(img);
			if (articleDoc.body && articleDoc.body.firstChild) {
				articleDoc.body.insertBefore(fig, articleDoc.body.firstChild);
			} else if (articleDoc.documentElement) {
				articleDoc.documentElement.insertBefore(fig, articleDoc.documentElement.firstChild);
			}
		},

		metadata(article) {
			return {
				title: article.title || 'Untitled',
				author: article.byline || 'Unknown',
				url,
				sourceType: 'web',
				unsubscribeLink: null,
				unsubscribeOneClick: false,
			};
		},
	};
}
