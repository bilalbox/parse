import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import puppeteer from '@cloudflare/puppeteer';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import PostalMime from 'postal-mime';

type AppEnv = Env & { PARSE_TOKEN?: string; PARSE_QUEUE: Queue<{ url: string }> };

const app = new Hono<{ Bindings: AppEnv }>();

// Protect all API routes with a Bearer token when PARSE_TOKEN is configured.
// Skip auth in dev/local if the secret is not set.
const requireAuth = createMiddleware<{ Bindings: AppEnv }>(async (c, next) => {
	const token = c.env.PARSE_TOKEN;
	if (!token) return next();
	const auth = c.req.header('Authorization');
	if (auth !== `Bearer ${token}`) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	return next();
});

app.use('/api/*', requireAuth);

// Root route handled by Cloudflare Static Assets (public/index.html)

async function uploadToR2(img: any, imgBuffer: ArrayBuffer, contentType: string, env: AppEnv): Promise<void> {
	const ext = (contentType.split('/')[1] || 'img').split(';')[0];
	const key = `${crypto.randomUUID()}.${ext}`;
	await env.MEDIA_BUCKET.put(key, imgBuffer, { httpMetadata: { contentType } });
	img.setAttribute('src', `/media/${key}`);
	img.removeAttribute('srcset');
	img.removeAttribute('sizes');
}

// Pull the R2 object keys out of a stored article's content. Images uploaded
// during parsing are rewritten to /media/<key> (see uploadToR2), so a delete
// can find and purge them. Returns deduped keys; safe on null/garbage content.
function extractMediaKeys(content: string | null): string[] {
	if (!content) return [];
	const keys = new Set<string>();
	const re = /\/media\/([A-Za-z0-9._-]+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		keys.add(match[1]);
	}
	return [...keys];
}

type EmailHeader = { key: string; value: string };

// Parse RFC 2369 List-Unsubscribe / RFC 8058 List-Unsubscribe-Post headers.
// Returns the preferred actionable link (https over mailto) and whether the
// sender supports automated one-click POST unsubscribe.
function extractUnsubscribe(headers: EmailHeader[] | undefined): { link: string | null; oneClick: boolean } {
	const getHeader = (key: string) =>
		headers?.find((h) => h.key.toLowerCase() === key)?.value || '';

	const listUnsubscribe = getHeader('list-unsubscribe');
	if (!listUnsubscribe) return { link: null, oneClick: false };

	const links = (listUnsubscribe.match(/<([^>]+)>/g) || []).map((l) => l.slice(1, -1).trim());
	const httpLink = links.find((l) => /^https?:\/\//i.test(l)) || null;
	const mailtoLink = links.find((l) => /^mailto:/i.test(l)) || null;

	// One-click is only valid when there's an https target AND the sender opted in.
	const oneClick = !!httpLink && /one-click/i.test(getHeader('list-unsubscribe-post'));

	return { link: httpLink || mailtoLink, oneClick };
}

// Anchor text / context that marks a transactional call-to-action button.
// These emails ("confirm your subscription", "verify your email") hinge on a
// single button that Readability discards as boilerplate.
const ACTION_TEXT_RE =
	/\b(confirm|verif(?:y|ied)|activat|finaliz|complete|validate|opt[\s-]?in|subscrib|sign[\s-]?up|get started|click here|continue|accept|approve)\b/i;

// Find button-like anchors in the original email document. Readability strips
// these (low text, high link density, table/div wrappers), so we collect them
// up front and re-attach any that don't survive parsing. Returns deduped
// { href, text } pairs in document order, excluding mailto: and the
// unsubscribe link (handled separately).
function extractActionLinks(doc: any, unsubscribeLink: string | null): { href: string; text: string }[] {
	const seen = new Set<string>();
	const links: { href: string; text: string }[] = [];

	for (const a of Array.from(doc.querySelectorAll('a[href]')) as any[]) {
		const href = (a.getAttribute('href') || '').trim();
		if (!href || /^(mailto:|tel:|#|javascript:)/i.test(href)) continue;
		if (!/^https?:\/\//i.test(href)) continue;
		if (href === unsubscribeLink) continue;

		const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
		const style = (a.getAttribute('style') || '').toLowerCase();
		const isStyledButton =
			a.getAttribute('role') === 'button' ||
			(/background(-color)?\s*:/.test(style) && /padding\s*:/.test(style));

		// Keep anchors that read like an action button — by text or by styling.
		if (!ACTION_TEXT_RE.test(text) && !isStyledButton) continue;
		if (seen.has(href)) continue;

		seen.add(href);
		links.push({ href, text: text || 'Open link' });
	}

	return links;
}

// Helpers for advanced image handling
function resolveLazyImages(doc: any) {
	const images = Array.from(doc.querySelectorAll('img')) as any[];
	const lazyAttributes = ['data-src', 'data-lazy-src', 'data-original', 'data-fallback-src', 'data-actual-src', 'data-src-webp'];
	for (const img of images) {
		let src = img.getAttribute('src');
		const isPlaceholder = !src || src.startsWith('data:image/') || src.includes('placeholder') || src.includes('transparent') || src.includes('1x1') || src.includes('blank');

		let resolvedFromLazy = false;
		if (isPlaceholder) {
			for (const attr of lazyAttributes) {
				const lazyVal = img.getAttribute(attr);
				if (lazyVal && lazyVal.trim().startsWith('http')) {
					img.setAttribute('src', lazyVal.trim());
					src = lazyVal.trim();
					resolvedFromLazy = true;
					break;
				}
			}
		}

		// Only fall back to srcset if we still don't have a real image — a
		// successful lazy-attr resolution above must not be clobbered.
		if (!resolvedFromLazy && (!src || isPlaceholder) && img.getAttribute('srcset')) {
			const srcset = img.getAttribute('srcset');
			const candidates = srcset.split(',').map((cand: string) => {
				const parts = cand.trim().split(/\s+/);
				return { url: parts[0], width: parseInt(parts[1]) || 0 };
			}).sort((a: any, b: any) => b.width - a.width);
			if (candidates.length > 0 && candidates[0].url) {
				img.setAttribute('src', candidates[0].url);
			}
		}
	}
}

// Heuristic for tracking/spacer pixels we don't want to rescue. Keyword checks
// use path/word boundaries so legitimate URLs (e.g. /openverse/, pixel-art.png,
// opengraph.io) aren't mistaken for trackers.
function isTrackingPixel(src: string, width: number, height: number): boolean {
	if (width === 1 && height === 1) return true;
	return /(^|[\/_.-])(tracker|tracking|beacon|spacer|pixel)([\/_.-]|$)/i.test(src);
}

// Normalize an image src for dedup comparison: drop the query/hash and keep the
// path so Readability's URL rewriting (relative→absolute, added query params)
// doesn't make a surviving image look "missing" and get duplicated.
function normalizeImageSrc(src: string): string {
	const trimmed = src.trim();
	const noFragment = trimmed.split('#')[0].split('?')[0];
	const slash = noFragment.lastIndexOf('/');
	return (slash >= 0 ? noFragment.slice(slash + 1) : noFragment) || noFragment;
}

function convertCenterTags(doc: any) {
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

function extractFeaturedImage(doc: any, url: string): string | null {
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

async function parseArticle(url: string, env: AppEnv): Promise<{ id: string; title: string }> {
	const browser = await puppeteer.launch(env.BROWSER);
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
	const html = await page.content();
	await browser.close();

	const { document } = parseHTML(html);

	// Advanced Image Handling: Pre-processing
	convertCenterTags(document);
	resolveLazyImages(document);
	const featuredImageUrl = extractFeaturedImage(document, url);

	const reader = new Readability(document);
	const article = reader.parse();
	if (!article) throw new Error('Failed to extract article content');

	const articleId = crypto.randomUUID();

	const { document: articleDoc } = parseHTML(article.content);

	// Rescue featured image if missing
	if (featuredImageUrl) {
		const imgs = Array.from(articleDoc.querySelectorAll('img')) as any[];
		const hasFeatured = imgs.some(img => {
			const src = img.getAttribute('src') || '';
			return src === featuredImageUrl || src.includes(featuredImageUrl) || featuredImageUrl.includes(src);
		});
		if (!hasFeatured) {
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
		}
	}

	const images = Array.from(articleDoc.querySelectorAll('img')) as any[];

	await Promise.all(images.map(async (img) => {
		const src = img.getAttribute('src');
		if (!src) return;
		try {
			const absoluteUrl = new URL(src, url).href;
			const imgRes = await fetch(absoluteUrl);
			if (!imgRes.ok) return;
			const imgBuffer = await imgRes.arrayBuffer();
			const contentType = imgRes.headers.get('content-type') || 'application/octet-stream';
			await uploadToR2(img, imgBuffer, contentType, env);
		} catch (e) {
			console.error('Failed to process image:', src, e);
		}
	}));

	article.content = articleDoc.toString();

	const title = article.title || 'Untitled';
	await env.DB.prepare(
		`INSERT INTO articles (id, title, author, url, content, source_type, unsubscribe_link, created_at)
		 VALUES (?, ?, ?, ?, ?, 'web', NULL, datetime('now'))`
	).bind(articleId, title, article.byline || 'Unknown', url, JSON.stringify(article)).run();

	return { id: articleId, title };
}

// Parsing runs asynchronously: queue the URL and let the consumer call
// parseArticle (see the `queue` handler below).
app.post('/api/queue', async (c) => {
	const { url } = await c.req.json();
	if (!url) return c.json({ error: 'URL is required' }, 400);
	await c.env.PARSE_QUEUE.send({ url });
	return c.json({ queued: true });
});

// Endpoint to retrieve all articles (metadata only).
// Defaults to the active library; pass ?archived=1 to list archived items.
app.get('/api/articles', async (c) => {
	const archived = c.req.query('archived') === '1' ? 1 : 0;
	const articles = await c.env.DB.prepare(
		`SELECT id, title, author, url, unsubscribe_link, archived, created_at
		 FROM articles WHERE archived = ? ORDER BY created_at DESC LIMIT 50`
	).bind(archived).all();
	return c.json(articles.results);
});

// Endpoint to retrieve an article
app.get('/api/articles/:id', async (c) => {
	const id = c.req.param('id');
	
	const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ?')
		.bind(id)
		.first();
		
	if (!article) return c.json({ error: 'Not found' }, 404);
	
	return c.json(article);
});

// Unsubscribe from a newsletter (HTTP only — no email sending).
// One-click links are POSTed server-side (RFC 8058); other links are returned
// for the client to open in a browser / mail client.
app.post('/api/articles/:id/unsubscribe', async (c) => {
	const id = c.req.param('id');
	const row = await c.env.DB.prepare(
		'SELECT unsubscribe_link, unsubscribe_one_click FROM articles WHERE id = ?'
	).bind(id).first<{ unsubscribe_link: string | null; unsubscribe_one_click: number }>();

	if (!row) return c.json({ error: 'Not found' }, 404);
	const link = row.unsubscribe_link;
	if (!link) return c.json({ error: 'No unsubscribe link for this article' }, 400);

	// mailto: can't be actioned server-side without an email sender — hand it to the client.
	if (/^mailto:/i.test(link)) return c.json({ action: 'mailto', link });

	if (row.unsubscribe_one_click) {
		try {
			const res = await fetch(link, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'List-Unsubscribe=One-Click',
			});
			return c.json({ action: 'one-click', ok: res.ok, status: res.status });
		} catch (error: any) {
			return c.json({ error: error.message }, 502);
		}
	}

	// Plain https link — may be a confirmation page, so let the user open it.
	return c.json({ action: 'open', link });
});

// Archive / unarchive an article. Archived items drop out of the default
// library list but keep their content and images.
app.patch('/api/articles/:id', async (c) => {
	const id = c.req.param('id');
	const body = await c.req.json().catch(() => ({}));
	const archived = body.archived ? 1 : 0;

	const res = await c.env.DB.prepare('UPDATE articles SET archived = ? WHERE id = ?')
		.bind(archived, id)
		.run();

	if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);
	return c.json({ success: true, id, archived: !!archived });
});

// Permanently delete an article and purge its images from R2. The stored
// content references uploaded images as /media/<key>, so we pull those keys
// out and delete them before dropping the row (FTS cleanup runs via trigger).
app.delete('/api/articles/:id', async (c) => {
	const id = c.req.param('id');
	const row = await c.env.DB.prepare('SELECT content FROM articles WHERE id = ?')
		.bind(id)
		.first<{ content: string | null }>();

	if (!row) return c.json({ error: 'Not found' }, 404);

	const keys = extractMediaKeys(row.content);
	if (keys.length) {
		try {
			await c.env.MEDIA_BUCKET.delete(keys);
		} catch (e) {
			console.error('Failed to purge R2 media for article', id, e);
		}
	}

	await c.env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();
	return c.json({ success: true, id, mediaDeleted: keys.length });
});

// Endpoint to serve images from R2
app.get('/media/:key', async (c) => {
	const key = c.req.param('key');
	
	const object = await c.env.MEDIA_BUCKET.get(key);
	if (!object) return c.json({ error: 'Image not found' }, 404);
	
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
	
	return new Response(object.body, { headers });
});

// Example FTS5 Search Endpoint
app.get('/api/search', async (c) => {
	const query = c.req.query('q');
	if (!query) return c.json({ error: 'Query is required' }, 400);

	// Assuming an FTS5 virtual table named 'articles_fts' linked to 'articles'
	const results = await c.env.DB.prepare(`
		SELECT id, title, snippet(articles_fts, -1, '<b>', '</b>', '...', 64) as match_snippet
		FROM articles_fts
		WHERE content MATCH ?
		ORDER BY rank
		LIMIT 10
	`).bind(query).all();

	return c.json(results.results);
});

export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<{ url: string }>, env: AppEnv): Promise<void> {
		for (const msg of batch.messages) {
			try {
				await parseArticle(msg.body.url, env);
				msg.ack();
			} catch (err) {
				console.error('Queue parse failed:', msg.body.url, err);
				msg.retry();
			}
		}
	},
	async email(message: any, env: AppEnv, ctx: any) {
		const parser = new PostalMime();
		const email = await parser.parse(message.raw);
		
		// 1. Extract unsubscribe link + one-click capability (RFC 2369 / RFC 8058)
		const { link: unsubscribeLink, oneClick: unsubscribeOneClick } = extractUnsubscribe(email.headers);

		// 2. Extract HTML and run Readability
		const rawHtml = email.html || email.text || '';

		// Collect action/button links before Readability runs — it mutates the
		// document it parses, and strips CTA buttons (confirm/verify) as boilerplate.
		const { document: rawDoc } = parseHTML(rawHtml);
		const actionLinks = extractActionLinks(rawDoc, unsubscribeLink);

		const { document } = parseHTML(rawHtml);

		// Advanced Image Handling: Pre-processing
		convertCenterTags(document);
		resolveLazyImages(document);

		// Extract all large images before Readability strips them out
		const allOriginalImgs = Array.from(document.querySelectorAll('img')) as any[];
		const originalImageSrcs = new Set<string>();
		for (const img of allOriginalImgs) {
			const src = img.getAttribute('src');
			const width = parseInt(img.getAttribute('width') || '0', 10);
			const height = parseInt(img.getAttribute('height') || '0', 10);
			if (src && !isTrackingPixel(src, width, height)) {
				originalImageSrcs.add(src);
			}
		}

		const reader = new Readability(document);
		const article = reader.parse();
		if (!article) {
			console.error('Failed to extract article from email');
			return;
		}

		const articleId = crypto.randomUUID();
		const { document: articleDoc } = parseHTML(article.content);

		// Re-attach missing large images dropped by Readability (e.g., inside tables)
		const survivingImgSrcs = new Set(
			(Array.from(articleDoc.querySelectorAll('img')) as any[])
				.map((img) => img.getAttribute('src'))
				.filter((s): s is string => !!s)
				.map(normalizeImageSrc)
		);
		const missingImages = Array.from(originalImageSrcs).filter(src => !survivingImgSrcs.has(normalizeImageSrc(src)));
		if (missingImages.length) {
			const section = articleDoc.createElement('div');
			section.setAttribute('class', 'parsed-rescued-images');
			const heading = articleDoc.createElement('p');
			const strong = articleDoc.createElement('strong');
			strong.textContent = 'Images from this email';
			heading.appendChild(strong);
			section.appendChild(heading);
			for (const src of missingImages) {
				const p = articleDoc.createElement('p');
				const img = articleDoc.createElement('img');
				img.setAttribute('src', src);
				p.appendChild(img);
				section.appendChild(p);
			}
			(articleDoc.body || articleDoc.documentElement).appendChild(section);
		}

		const images = Array.from(articleDoc.querySelectorAll('img')) as any[];

		// 3. Process images (Inline CID + External)
		await Promise.all(images.map(async (img) => {
			const src = img.getAttribute('src');
			if (!src) return;

			try {
				let imgBuffer: ArrayBuffer | null = null;
				let contentType = 'application/octet-stream';

				if (src.startsWith('cid:')) {
					const cid = src.substring(4);
					const attachment = email.attachments?.find((a: any) => a.contentId === `<${cid}>` || a.contentId === cid);
					if (attachment) {
						const content = attachment.content as Uint8Array;
						imgBuffer = content.buffer.slice(
							content.byteOffset,
							content.byteOffset + content.byteLength
						) as ArrayBuffer;
						contentType = attachment.mimeType;
					}
				} else {
					const imgRes = await fetch(new URL(src).href);
					if (imgRes.ok) {
						imgBuffer = await imgRes.arrayBuffer();
						contentType = imgRes.headers.get('content-type') || contentType;
					}
				}

				if (imgBuffer) await uploadToR2(img, imgBuffer, contentType, env);
			} catch (e) {
				console.error('Failed to process email image:', src, e);
			}
		}));

		// Re-attach action buttons (confirm/verify links) that Readability dropped.
		// Only those missing from the parsed content, so we don't duplicate links
		// that survived intact.
		const survivingHrefs = new Set(
			(Array.from(articleDoc.querySelectorAll('a[href]')) as any[]).map((a) => a.getAttribute('href'))
		);
		const missing = actionLinks.filter((l) => !survivingHrefs.has(l.href));
		if (missing.length) {
			const section = articleDoc.createElement('div');
			section.setAttribute('class', 'parsed-action-links');
			const heading = articleDoc.createElement('p');
			const strong = articleDoc.createElement('strong');
			strong.textContent = 'Links from this email';
			heading.appendChild(strong);
			section.appendChild(heading);
			for (const { href, text } of missing) {
				const p = articleDoc.createElement('p');
				const a = articleDoc.createElement('a');
				a.setAttribute('href', href);
				a.textContent = text;
				p.appendChild(a);
				section.appendChild(p);
			}
			(articleDoc.body || articleDoc.documentElement).appendChild(section);
		}

		article.content = articleDoc.toString();

		// 4. Save to DB
		const query = `
			INSERT INTO articles (id, title, author, url, content, source_type, unsubscribe_link, unsubscribe_one_click, created_at)
			VALUES (?, ?, ?, ?, ?, 'email', ?, ?, datetime('now'))
		`;

		const author = email.from?.name || email.from?.address || 'Unknown Sender';
		const title = email.subject || 'No Subject';
		const url = `email://${message.headers.get('Message-ID') || crypto.randomUUID()}`;

		await env.DB.prepare(query)
			.bind(
				articleId,
				title,
				author,
				url,
				JSON.stringify(article),
				unsubscribeLink,
				unsubscribeOneClick ? 1 : 0
			)
			.run();
	}
};
