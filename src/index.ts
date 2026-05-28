import { Hono } from 'hono';
import puppeteer from '@cloudflare/puppeteer';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import PostalMime from 'postal-mime';

const app = new Hono<{ Bindings: Env }>();

// Root route handled by Cloudflare Static Assets (public/index.html)

app.post('/api/parse', async (c) => {
	const { url } = await c.req.json();
	if (!url) return c.json({ error: 'URL is required' }, 400);

	try {
		// 1. Launch Headless Browser via Cloudflare Browser Rendering
		const browser = await puppeteer.launch(c.env.BROWSER);
		const page = await browser.newPage();
		
		// Navigate and wait for network idle to ensure lazy-loaded assets and JS execute
		await page.goto(url, { waitUntil: 'networkidle0' });
		
		// Extract fully rendered HTML and basic metadata
		const html = await page.content();
		await browser.close();

		// 2. Parse DOM with Linkedom (lightweight JSDOM alternative for Workers)
		const { document } = parseHTML(html);

		// 3. Extract content using Mozilla Readability
		const reader = new Readability(document);
		const article = reader.parse();

		if (!article) {
			return c.json({ error: 'Failed to extract article content' }, 500);
		}

		const articleId = crypto.randomUUID();

		// 4. Image Processing
		const { document: articleDoc } = parseHTML(article.content);
		const images = Array.from(articleDoc.querySelectorAll('img')) as any[];
		
		for (const img of images) {
			let src = img.getAttribute('src');
			if (!src) continue;

			try {
				// Resolve absolute URL
				const absoluteUrl = new URL(src, url).href;
				
				// Fetch image
				const imgRes = await fetch(absoluteUrl);
				if (!imgRes.ok) continue;
				
				const imgBuffer = await imgRes.arrayBuffer();
				const contentType = imgRes.headers.get('content-type') || 'application/octet-stream';
				
				// Generate a unique key for R2
				// sanitize the extension
				const rawExt = contentType.split('/')[1] || 'img';
				const ext = rawExt.split(';')[0];
				const key = `${crypto.randomUUID()}.${ext}`;
				
				// Upload to R2
				await c.env.MEDIA_BUCKET.put(key, imgBuffer, {
					httpMetadata: { contentType }
				});
				
				// Replace src with our own endpoint
				img.setAttribute('src', `/media/${key}`);
				
				// Strip responsive attributes that might override our src
				img.removeAttribute('srcset');
				img.removeAttribute('sizes');
			} catch (e) {
				console.error('Failed to process image:', src, e);
				// Leave original src if fetching/uploading fails
			}
		}
		
		// Update article content with modified HTML
		article.content = articleDoc.toString();

		// 5. Store in D1
		// We store the full JSON payload in the 'content' column (assuming it's a JSON type)
		const query = `
			INSERT INTO articles (id, title, author, url, content, source_type, unsubscribe_link, created_at)
			VALUES (?, ?, ?, ?, ?, 'web', NULL, datetime('now'))
		`;
		
		await c.env.DB.prepare(query)
			.bind(
				articleId,
				article.title,
				article.byline || 'Unknown',
				url,
				JSON.stringify(article) // Storing the full sanitized HTML payload in JSON column
			)
			.run();

		// 6. Return success
		return c.json({
			success: true,
			id: articleId,
			title: article.title,
			message: 'Article parsed and saved to D1 successfully.'
		});
	} catch (error: any) {
		return c.json({ error: error.message }, 500);
	}
});

// Endpoint to retrieve all articles (metadata only)
app.get('/api/articles', async (c) => {
	const articles = await c.env.DB.prepare(
		'SELECT id, title, author, url, created_at FROM articles ORDER BY created_at DESC LIMIT 50'
	).all();
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
	async email(message: any, env: Env, ctx: any) {
		const parser = new PostalMime();
		const email = await parser.parse(message.raw);
		
		// 1. Extract unsubscribe link
		let unsubscribeLink = null;
		const listUnsubscribe = email.headers?.find((h: any) => h.key.toLowerCase() === 'list-unsubscribe');
		if (listUnsubscribe) {
			const links = listUnsubscribe.value.match(/<(.*?)>/g) || [];
			if (links.length > 0) {
				// prefer http/https
				const httpLink = links.find((l: string) => l.includes('http://') || l.includes('https://'));
				unsubscribeLink = httpLink ? httpLink.replace(/[<>]/g, '') : links[0]!.replace(/[<>]/g, '');
			}
		}

		// 2. Extract HTML and run Readability
		const rawHtml = email.html || email.text || '';
		const { document } = parseHTML(rawHtml);
		
		const reader = new Readability(document);
		const article = reader.parse();
		if (!article) {
			console.error('Failed to extract article from email');
			return;
		}

		const articleId = crypto.randomUUID();
		const { document: articleDoc } = parseHTML(article.content);
		const images = Array.from(articleDoc.querySelectorAll('img')) as any[];

		// 3. Process images (Inline CID + External)
		for (const img of images) {
			let src = img.getAttribute('src');
			if (!src) continue;

			try {
				let imgBuffer: ArrayBuffer | null = null;
				let contentType = 'application/octet-stream';
				
				if (src.startsWith('cid:')) {
					const cid = src.substring(4);
					const attachment = email.attachments?.find((a: any) => a.contentId === `<${cid}>` || a.contentId === cid);
					if (attachment) {
						// PostalMime provides attachment.content as a Uint8Array
						const content = attachment.content as Uint8Array;
						imgBuffer = content.buffer.slice(
							content.byteOffset,
							content.byteOffset + content.byteLength
						) as ArrayBuffer;
						contentType = attachment.mimeType;
					}
				} else {
					// External image
					const absoluteUrl = new URL(src).href;
					const imgRes = await fetch(absoluteUrl);
					if (imgRes.ok) {
						imgBuffer = await imgRes.arrayBuffer();
						contentType = imgRes.headers.get('content-type') || contentType;
					}
				}

				if (imgBuffer) {
					const rawExt = contentType.split('/')[1] || 'img';
					const ext = rawExt.split(';')[0];
					const key = `${crypto.randomUUID()}.${ext}`;
					
					await env.MEDIA_BUCKET.put(key, imgBuffer, {
						httpMetadata: { contentType }
					});
					
					img.setAttribute('src', `/media/${key}`);
					img.removeAttribute('srcset');
					img.removeAttribute('sizes');
				}
			} catch (e) {
				console.error('Failed to process email image:', src, e);
			}
		}

		article.content = articleDoc.toString();

		// 4. Save to DB
		const query = `
			INSERT INTO articles (id, title, author, url, content, source_type, unsubscribe_link, created_at)
			VALUES (?, ?, ?, ?, ?, 'email', ?, datetime('now'))
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
				unsubscribeLink
			)
			.run();
	}
};
