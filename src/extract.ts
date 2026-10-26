import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { type MediaBytes, rescueMedia } from './media';

// Everything a Source's rescue hook needs to re-attach dropped content:
// the parsed Article document to mutate, a pristine (preprocessed) copy of the
// original document to read from, and the base URL for resolving links.
export interface RescueCtx {
	articleDoc: any;
	sourceDoc: any;
	baseUrl: string;
}

// The metadata a Source derives for a finished Article. Some fields come from
// the Readability result (title/byline), some from the Source itself (the
// originating url, unsubscribe info from email headers).
export interface ArticleMeta {
	title: string;
	author: string;
	url: string | null;
	sourceType: 'web' | 'email';
	unsubscribeLink: string | null;
	unsubscribeOneClick: boolean;
	published: string | null;
	wordCount: number | null;
}

// The seam in front of the extraction spine. One adapter per ingest path
// (WebSource, EmailSource) supplies the raw HTML and the three things that
// differ per path: image-byte resolution, content rescue, and metadata.
export interface Source {
	html: string;
	baseUrl: string;
	resolveBytes(src: string): Promise<MediaBytes | null>;
	rescue(ctx: RescueCtx): void;
	// Called last, after rescue — so a Source may run a destructive parser (e.g.
	// Defuddle) on sourceDoc, which is disposable by this point.
	metadata(article: any, sourceDoc: any): ArticleMeta;
}

// A finished Article, ready to persist. `content` is the Readability result
// (JSON) with its inner HTML rewritten so images point at /media/<key>.
export interface Article {
	id: string;
	title: string;
	author: string;
	url: string | null;
	sourceType: 'web' | 'email';
	unsubscribeLink: string | null;
	unsubscribeOneClick: boolean;
	published: string | null;
	wordCount: number | null;
	content: string;
}

const EXTENDED_LAZY_ATTRS = [
	'data-src',
	'data-lazy-src',
	'data-original',
	'data-fallback-src',
	'data-actual-src',
	'data-src-webp',
	'data-orig-file',
	'data-large-file',
	'data-full-url',
	'data-zoom-src',
	'data-hi-res-src',
	'data-url',
	'data-lazy',
	'nitro-lazy-src',
];

function isImagePlaceholder(src: string | null | undefined): boolean {
	return (
		!src ||
		src.startsWith('data:image/') ||
		src.includes('placeholder') ||
		src.includes('transparent') ||
		src.includes('1x1') ||
		src.includes('blank')
	);
}

// Pull lazy-loaded image URLs out of data-* attributes / srcset into a real
// src so Readability and the image step see a fetchable image, not a spacer.
export function resolveLazyImages(doc: any) {
	// 1. Unpack <noscript> fallback images if adjacent/prior <img> is a placeholder
	const noscripts = Array.from(doc.querySelectorAll('noscript')) as any[];
	for (const ns of noscripts) {
		const prev = ns.previousElementSibling;
		if (prev && prev.tagName === 'IMG' && isImagePlaceholder(prev.getAttribute('src'))) {
			const m = (ns.innerHTML || ns.textContent || '').match(/<img[^>]+src=["']([^"']+)["']/i);
			if (m && m[1]) prev.setAttribute('src', m[1]);
		}
	}

	// 2. Unpack <picture><source srcset="...">
	const pictures = Array.from(doc.querySelectorAll('picture')) as any[];
	for (const pic of pictures) {
		const img = pic.querySelector('img');
		if (img && isImagePlaceholder(img.getAttribute('src'))) {
			const source = pic.querySelector('source[srcset]');
			if (source) {
				const srcset = source.getAttribute('srcset') || '';
				const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
				if (firstUrl) img.setAttribute('src', firstUrl);
			}
		}
	}

	// 3. Resolve data-* lazy attributes & data-srcset
	const images = Array.from(doc.querySelectorAll('img')) as any[];
	for (const img of images) {
		let src = img.getAttribute('src');
		const isPlaceholder = isImagePlaceholder(src);

		let resolvedFromLazy = false;
		if (isPlaceholder) {
			for (const attr of EXTENDED_LAZY_ATTRS) {
				const lazyVal = img.getAttribute(attr);
				if (lazyVal && lazyVal.trim().length > 0) {
					img.setAttribute('src', lazyVal.trim());
					src = lazyVal.trim();
					resolvedFromLazy = true;
					break;
				}
			}
		}

		// Only fall back to srcset / data-srcset if we still don't have a real image — a
		// successful lazy-attr resolution above must not be clobbered.
		if (!resolvedFromLazy && (!src || isPlaceholder)) {
			const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
			if (srcset) {
				const candidates = srcset
					.split(',')
					.map((cand: string) => {
						const parts = cand.trim().split(/\s+/);
						return { url: parts[0], width: parseInt(parts[1]) || 0 };
					})
					.sort((a: any, b: any) => b.width - a.width);
				if (candidates.length > 0 && candidates[0].url) {
					img.setAttribute('src', candidates[0].url);
				}
			}
		}
	}
}

// Neutralize elements that trigger Readability's aggressive cull rules:
// - Readability deletes all <aside> tags unconditionally; convert to preserved callout divs.
// - Neutralize negative classes from blockquotes and figures so unlikelyCandidates regex won't drop them.
export function neutralizeAsidesAndQuotes(doc: any) {
	const asides = Array.from(doc.querySelectorAll('aside')) as any[];
	for (const aside of asides) {
		const div = doc.createElement('div');
		div.setAttribute('class', 'preserved-aside-callout');
		div.setAttribute('data-preserved-aside', 'true');
		for (const attr of aside.attributes || []) {
			if (attr.name !== 'class') div.setAttribute(attr.name, attr.value);
		}
		while (aside.firstChild) div.appendChild(aside.firstChild);
		aside.parentNode?.replaceChild(div, aside);
	}

	const NEGATIVE_RE = /(pullquote|quote-box|callout|sidebar|extra|social)/i;
	const quotesAndFigures = Array.from(doc.querySelectorAll('blockquote, figure')) as any[];
	for (const el of quotesAndFigures) {
		const cls = el.getAttribute('class');
		if (cls && NEGATIVE_RE.test(cls)) {
			el.setAttribute('class', cls.replace(NEGATIVE_RE, 'preserved-$1'));
		}
	}
}

// Replace deprecated <center> tags with style-equivalent <div>s so Readability
// (which ignores <center>) keeps the centered content.
export function convertCenterTags(doc: any) {
	const centers = Array.from(doc.querySelectorAll('center')) as any[];
	for (const center of centers) {
		const div = doc.createElement('div');
		div.setAttribute('style', (center.getAttribute('style') || '') + '; text-align: center;');
		for (const attr of center.attributes || []) {
			if (attr.name !== 'style') div.setAttribute(attr.name, attr.value);
		}
		while (center.firstChild) div.appendChild(center.firstChild);
		center.parentNode?.replaceChild(div, center);
	}
}

// DOM normalisation every Source needs before Readability runs.
function preprocess(doc: any) {
	convertCenterTags(doc);
	resolveLazyImages(doc);
	neutralizeAsidesAndQuotes(doc);
}

// The extraction spine. Parses the Source's HTML twice — a pristine copy for
// the Source to inspect, a working copy Readability consumes (Readability
// mutates its input) — runs Readability, lets the Source rescue dropped
// content, rewrites images to R2, and returns an Article ready to persist.
export async function extractArticle(source: Source, bucket: R2Bucket): Promise<Article> {
	const { document: sourceDoc } = parseHTML(source.html);
	preprocess(sourceDoc);

	const { document: workingDoc } = parseHTML(source.html);
	preprocess(workingDoc);

	const reader = new Readability(workingDoc, {
		charThreshold: 20,
		nbTopCandidates: 10,
		keepClasses: false,
		classesToPreserve: [
			'caption',
			'highlight',
			'screenshot',
			'wp-block-image',
			'wp-block-quote',
			'callout',
			'preserved-aside-callout'
		]
	});
	const article = reader.parse();
	if (!article) throw new Error('Failed to extract article content');

	const id = crypto.randomUUID();
	const { document: articleDoc } = parseHTML(article.content);

	// Let the Source re-attach whatever Readability dropped (featured image,
	// missing images, action links) before we mediate images.
	source.rescue({ articleDoc, sourceDoc, baseUrl: source.baseUrl });

	// Rewrite every image to R2 via the Source's byte resolver (network / cid:).
	await rescueMedia(articleDoc, source.resolveBytes, bucket);

	article.content = articleDoc.toString();

	const meta = source.metadata(article, sourceDoc);
	return {
		id,
		title: meta.title,
		author: meta.author,
		url: meta.url,
		sourceType: meta.sourceType,
		unsubscribeLink: meta.unsubscribeLink,
		unsubscribeOneClick: meta.unsubscribeOneClick,
		published: meta.published,
		wordCount: meta.wordCount,
		content: JSON.stringify(article),
	};
}

// Find a page's featured image (og:image / twitter:image / common WP classes)
// and resolve it to an absolute URL. Used by WebSource's rescue.
export function extractFeaturedImage(doc: any, url: string): string | null {
	let featured = '';
	const og = doc.querySelector('meta[property="og:image"]');
	if (og) featured = og.getAttribute('content');
	if (!featured) {
		const tw = doc.querySelector('meta[name="twitter:image"]');
		if (tw) featured = tw.getAttribute('content');
	}
	if (!featured) {
		const thumb = doc.querySelector('img.wp-post-image, img.featured-image, .featured-image img, .post-thumbnail img, .entry-header img');
		if (thumb) featured = thumb.getAttribute('src') || thumb.getAttribute('data-src');
	}
	if (featured) {
		try {
			return new URL(featured, url).href;
		} catch {
			return null;
		}
	}
	return null;
}
