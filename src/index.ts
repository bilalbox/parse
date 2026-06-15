import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import PostalMime from 'postal-mime';
import { extractArticle } from './extract';
import { createWebSource } from './sources/web';
import { createEmailSource } from './sources/email';
import { serveMedia } from './media';
import { articlePlainText, createArticleStore } from './store';
import { summarizeArticle } from './summarize';

type AppEnv = Env & { PARSE_TOKEN?: string; PARSE_QUEUE: Queue<{ url: string }> };

const app = new Hono<{ Bindings: AppEnv }>();

// Protect all API routes with a Bearer token when PARSE_TOKEN is configured.
// Skip auth in dev/local if the secret is not set.
// Supports query string '?token=...' for native browser elements (like audio tags).
const requireAuth = createMiddleware<{ Bindings: AppEnv }>(async (c, next) => {
	const token = c.env.PARSE_TOKEN;
	if (!token) return next();
	const auth = c.req.header('Authorization');
	const queryToken = c.req.query('token');
	if (auth === `Bearer ${token}` || queryToken === token) {
		return next();
	}
	return c.json({ error: 'Unauthorized' }, 401);
});

app.use('/api/*', cors({
	origin: '*',
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Authorization', 'Content-Type']
}));
app.use('/media/*', cors({
	origin: '*',
	allowMethods: ['GET', 'OPTIONS'],
	allowHeaders: ['Authorization', 'Content-Type']
}));
app.use('/api/*', requireAuth);

// Root route handled by Cloudflare Static Assets (public/index.html)

// Parsing runs asynchronously: queue the URL and let the consumer call
// extractArticle (see the `queue` handler below).
app.post('/api/queue', async (c) => {
	const { url } = await c.req.json();
	if (!url) return c.json({ error: 'URL is required' }, 400);
	await c.env.PARSE_QUEUE.send({ url });
	return c.json({ queued: true });
});

// Endpoint to retrieve all articles (metadata only).
// Defaults to the active library; pass ?archived=1 to list archived items.
app.get('/api/articles', async (c) => {
	const store = createArticleStore(c.env.DB);
	const articles = await store.list(c.req.query('archived') === '1');
	return c.json(articles);
});

// Endpoint to retrieve an article
app.get('/api/articles/:id', async (c) => {
	const store = createArticleStore(c.env.DB);
	const article = await store.get(c.req.param('id'));
	if (!article) return c.json({ error: 'Not found' }, 404);
	return c.json(article);
});

// Unsubscribe from a newsletter (HTTP only — no email sending).
// One-click links are POSTed server-side (RFC 8058); other links are returned
// for the client to open in a browser / mail client.
app.post('/api/articles/:id/unsubscribe', async (c) => {
	const store = createArticleStore(c.env.DB);
	const row = await store.get(c.req.param('id'));

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

// Summarize an article using Cloudflare Workers AI.
app.post('/api/articles/:id/summarize', async (c) => {
	const id = c.req.param('id');
	const store = createArticleStore(c.env.DB);
	const row = await store.get(id);

	if (!row) return c.json({ error: 'Not found' }, 404);

	// If a summary already exists, return it
	if (row.summary) {
		return c.json({ summary: row.summary });
	}

	const textContent = articlePlainText(row.content);
	if (!textContent) return c.json({ error: 'No content to summarize' }, 400);

	try {
		const summary = await summarizeArticle(c.env, id, textContent);
		return c.json({ summary });
	} catch (error: any) {
		console.error('AI Error:', error);
		return c.json({ error: 'Failed to generate summary: ' + error.message }, 500);
	}
});

// Archive / unarchive an article. Archived items drop out of the default
// library list but keep their content and images.
app.patch('/api/articles/:id', async (c) => {
	const id = c.req.param('id');
	const body = await c.req.json().catch(() => ({}));
	const archived = !!body.archived;

	const store = createArticleStore(c.env.DB);
	const existed = await store.setArchived(id, archived);

	if (!existed) return c.json({ error: 'Not found' }, 404);
	return c.json({ success: true, id, archived });
});

// Permanently delete an article and purge its images from R2. The store
// handles extracting media keys and deleting them before dropping the row.
app.delete('/api/articles/:id', async (c) => {
	const id = c.req.param('id');
	const store = createArticleStore(c.env.DB, c.env.MEDIA_BUCKET);
	const removed = await store.remove(id);

	if (!removed) return c.json({ error: 'Not found' }, 404);

	return c.json({ success: true, id });
});

// Endpoint to serve images from R2
app.get('/media/:key', async (c) => {
	const res = await serveMedia(c.env.MEDIA_BUCKET, c.req.param('key'));
	if (!res) return c.json({ error: 'Image not found' }, 404);
	return res;
});

// Example FTS5 Search Endpoint
app.get('/api/search', async (c) => {
	const query = c.req.query('q');
	if (!query) return c.json({ error: 'Query is required' }, 400);

	const store = createArticleStore(c.env.DB);
	return c.json(await store.search(query));
});

export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<{ url: string }>, env: AppEnv): Promise<void> {
		for (const msg of batch.messages) {
			try {
				const source = await createWebSource(msg.body.url, env.BROWSER);
				const article = await extractArticle(source, env.MEDIA_BUCKET);
				await createArticleStore(env.DB).create(article);
				msg.ack();
			} catch (err) {
				console.error('Queue parse failed:', msg.body.url, err);
				msg.retry();
			}
		}
	},
	async email(message: ForwardableEmailMessage, env: AppEnv, ctx: ExecutionContext): Promise<void> {
		const parser = new PostalMime();
		const email = await parser.parse(message.raw);

		const messageId = message.headers.get('Message-ID') || crypto.randomUUID();
		const source = createEmailSource(email, messageId);

		try {
			const article = await extractArticle(source, env.MEDIA_BUCKET);
			await createArticleStore(env.DB).create(article);

			const textContent = articlePlainText(article.content);
			if (textContent) {
				ctx.waitUntil(
					summarizeArticle(env, article.id, textContent)
						.catch(e => console.error('Background summary generation failed:', e))
				);
			}
		} catch (err) {
			console.error('Email parse failed:', messageId, err);
		}
	},
};
