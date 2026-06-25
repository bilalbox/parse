import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import { getCookie, setCookie } from 'hono/cookie';
import PostalMime from 'postal-mime';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { extractArticle } from './extract';
import { createWebSource } from './sources/web';
import { createEmailSource } from './sources/email';
import { serveMedia } from './media';
import { articlePlainText, createArticleStore } from './store';
import { validateSessionToken, getUserByEmailAlias, createUser, createSession, invalidateSession } from './users';
import type { User, Session } from './users';
import { summarizeArticle } from './summarize';

type AppEnv = Env & { 
	PARSE_QUEUE: Queue<{ url: string; userId: string }>;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	PUBLIC_URL: string;
};

type Variables = {
	user: User;
	session: Session;
};

const app = new Hono<{ Bindings: AppEnv, Variables: Variables }>();

const requireAuth = createMiddleware<{ Bindings: AppEnv, Variables: Variables }>(async (c, next) => {
	const sessionId = getCookie(c, 'SESSION_ID') || c.req.header('Authorization')?.replace('Bearer ', '');
	if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);
	
	const result = await validateSessionToken(c.env.DB, sessionId);
	if (!result) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	c.set('user', result.user);
	c.set('session', result.session);
	return next();
});

app.use('/api/*', cors({
	origin: (origin) => origin,
	credentials: true,
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Authorization', 'Content-Type']
}));
app.use('/media/*', cors({
	origin: (origin) => origin,
	credentials: true,
	allowMethods: ['GET', 'OPTIONS'],
	allowHeaders: ['Authorization', 'Content-Type']
}));

// OAuth Routes
app.get('/auth/google', async (c) => {
	// ponytail: APK installs are trusted (can't solve the widget anyway); identified by the
	// custom UA suffix set in capacitor.config.ts. Spoofable, but that's an accepted tradeoff here.
	const isNativeApp = (c.req.header('User-Agent') || '').includes('ParseAndroidApp');

	if (!isNativeApp) {
		const turnstileResponse = c.req.query('cf-turnstile-response');
		if (!turnstileResponse) {
			return c.redirect('/login?error=turnstile_failed');
		}

		const formData = new FormData();
		formData.append('secret', c.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA');
		formData.append('response', turnstileResponse);
		formData.append('remoteip', c.req.header('CF-Connecting-IP') || '');

		const turnstileResult = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			body: formData,
			method: 'POST',
		});

		const turnstileOutcome = await turnstileResult.json() as any;
		if (!turnstileOutcome.success) {
			return c.redirect('/login?error=turnstile_failed');
		}
	}

	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const redirectURI = new URL('/auth/google/callback', c.req.url).toString();
	const google = new Google(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, redirectURI);
	const url = google.createAuthorizationURL(state, codeVerifier, ['profile', 'email']);
	
	setCookie(c, 'google_oauth_state', state, { path: '/', secure: true, httpOnly: true, maxAge: 60 * 10, sameSite: 'Lax' });
	setCookie(c, 'google_code_verifier', codeVerifier, { path: '/', secure: true, httpOnly: true, maxAge: 60 * 10, sameSite: 'Lax' });
	
	return c.redirect(url.toString());
});

app.get('/auth/google/callback', async (c) => {
	const code = c.req.query('code');
	const state = c.req.query('state');
	const storedState = getCookie(c, 'google_oauth_state');
	const codeVerifier = getCookie(c, 'google_code_verifier');
	
	if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
		return c.json({ error: 'Invalid state' }, 400);
	}
	
	const redirectURI = new URL('/auth/google/callback', c.req.url).toString();
	const google = new Google(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, redirectURI);
	
	try {
		const tokens = await google.validateAuthorizationCode(code, codeVerifier);
		const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
			headers: { Authorization: `Bearer ${tokens.accessToken()}` }
		});
		const googleUser: any = await response.json();
		
		let user = await c.env.DB.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleUser.sub).first<User>();
		if (!user) {
			const invite = await c.env.DB.prepare('SELECT * FROM invites WHERE email = ? AND used_at IS NULL').bind(googleUser.email).first();
			
			if (!invite) {
				return c.redirect('/login?error=invite_required'); 
			}

			user = await createUser(c.env.DB, googleUser.sub, googleUser.email);
			
			await c.env.DB.prepare('UPDATE invites SET used_at = CURRENT_TIMESTAMP, used_by = ? WHERE email = ?')
				.bind(user.id, googleUser.email).run();
		}
		
		const session = await createSession(c.env.DB, user.id);
		setCookie(c, 'SESSION_ID', session.id, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
		
		return c.redirect('/');
	} catch (e) {
		console.error('OAuth failed', e);
		return c.json({ error: 'OAuth failed' }, 400);
	}
});

app.use('/api/*', requireAuth);

app.post('/api/auth/logout', async (c) => {
	await invalidateSession(c.env.DB, c.get('session').id);
	setCookie(c, 'SESSION_ID', '', { path: '/', maxAge: 0 });
	return c.json({ success: true });
});

app.get('/api/me', (c) => {
	return c.json(c.get('user'));
});

app.post('/api/settings', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const autoSummarize = body.auto_summarize_emails ? 1 : 0;
	await c.env.DB.prepare('UPDATE users SET auto_summarize_emails = ? WHERE id = ?').bind(autoSummarize, user.id).run();
	return c.json({ success: true });
});

// Root route handled by Cloudflare Static Assets (public/index.html)

app.post('/api/queue', async (c) => {
	const { url } = await c.req.json();
	if (!url) return c.json({ error: 'URL is required' }, 400);
	await c.env.PARSE_QUEUE.send({ url, userId: c.get('user').id });
	return c.json({ queued: true });
});

app.get('/api/articles', async (c) => {
	const store = createArticleStore(c.env.DB, c.get('user').id);
	const articles = await store.list(c.req.query('archived') === '1');
	return c.json(articles);
});

app.get('/api/articles/:id', async (c) => {
	const store = createArticleStore(c.env.DB, c.get('user').id);
	const article = await store.get(c.req.param('id'));
	if (!article) return c.json({ error: 'Not found' }, 404);
	return c.json(article);
});

app.post('/api/articles/:id/unsubscribe', async (c) => {
	const store = createArticleStore(c.env.DB, c.get('user').id);
	const row = await store.get(c.req.param('id'));

	if (!row) return c.json({ error: 'Not found' }, 404);
	const link = row.unsubscribe_link;
	if (!link) return c.json({ error: 'No unsubscribe link for this article' }, 400);

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

	return c.json({ action: 'open', link });
});

app.post('/api/articles/:id/summarize', async (c) => {
	const id = c.req.param('id');
	const store = createArticleStore(c.env.DB, c.get('user').id);
	const row = await store.get(id);

	if (!row) return c.json({ error: 'Not found' }, 404);

	if (row.summary) {
		return c.json({ summary: row.summary });
	}

	const textContent = articlePlainText(row.content);
	if (!textContent) return c.json({ error: 'No content to summarize' }, 400);

	try {
		const summary = await summarizeArticle(c.env, id, textContent, c.get('user').id);
		return c.json({ summary });
	} catch (error: any) {
		console.error('AI Error:', error);
		return c.json({ error: 'Failed to generate summary: ' + error.message }, 500);
	}
});

app.patch('/api/articles/:id', async (c) => {
	const id = c.req.param('id');
	const body = await c.req.json().catch(() => ({}));
	const archived = !!body.archived;

	const store = createArticleStore(c.env.DB, c.get('user').id);
	const existed = await store.setArchived(id, archived);

	if (!existed) return c.json({ error: 'Not found' }, 404);
	return c.json({ success: true, id, archived });
});

app.delete('/api/articles/:id', async (c) => {
	const id = c.req.param('id');
	const store = createArticleStore(c.env.DB, c.get('user').id, c.env.MEDIA_BUCKET);
	const removed = await store.remove(id);

	if (!removed) return c.json({ error: 'Not found' }, 404);

	return c.json({ success: true, id });
});

// Media bypasses requireAuth so images load easily in UI, but could be authenticated
// For now, let's keep it public or we would need to pass tokens to <img> tags
app.get('/media/:key', async (c) => {
	const res = await serveMedia(c.env.MEDIA_BUCKET, c.req.param('key'));
	if (!res) return c.json({ error: 'Image not found' }, 404);
	return res;
});

app.get('/api/search', async (c) => {
	const query = c.req.query('q');
	if (!query) return c.json({ error: 'Query is required' }, 400);

	const store = createArticleStore(c.env.DB, c.get('user').id);
	return c.json(await store.search(query));
});

app.get('/api/failures', async (c) => {
	const store = createArticleStore(c.env.DB, c.get('user').id);
	return c.json(await store.listFailures());
});

app.delete('/api/failures/:id', async (c) => {
	const store = createArticleStore(c.env.DB, c.get('user').id);
	await store.clearFailure(c.req.param('id'));
	return c.json({ success: true });
});

export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<{ url: string; userId: string }>, env: AppEnv): Promise<void> {
		for (const msg of batch.messages) {
			const { url, userId } = msg.body;
			try {
				const source = await createWebSource(url, env.BROWSER);
				const article = await extractArticle(source, env.MEDIA_BUCKET);
				await createArticleStore(env.DB, userId).create(article);
				msg.ack();
			} catch (err: any) {
				console.error('Queue parse failed:', url, err);
				await createArticleStore(env.DB, userId).recordFailure(url, err.message || String(err)).catch(() => {});
				msg.retry();
			}
		}
	},
	async email(message: ForwardableEmailMessage, env: AppEnv, ctx: ExecutionContext): Promise<void> {
		const parser = new PostalMime();
		const email = await parser.parse(message.raw);
		
		const toAddresses = email.to ? email.to.map((addr: any) => addr.address) : [];
		const alias = toAddresses.find((a: string) => a.startsWith('newsletters+') && a.endsWith('@23p.dev')) || message.to;
		
		const user = await getUserByEmailAlias(env.DB, alias);
		if (!user) {
			console.error('Email ingest failed: No user found for alias', alias);
			return;
		}

		const messageId = message.headers.get('Message-ID') || crypto.randomUUID();
		const source = createEmailSource(email, messageId);

		try {
			const article = await extractArticle(source, env.MEDIA_BUCKET);
			await createArticleStore(env.DB, user.id).create(article);

			const textContent = articlePlainText(article.content);
			if (textContent && user.auto_summarize_emails !== 0) {
				ctx.waitUntil(
					summarizeArticle(env, article.id, textContent, user.id)
						.catch((e: any) => console.error('Background summary generation failed:', e))
				);
			}
		} catch (err: any) {
			console.error('Email parse failed:', messageId, err);
			await createArticleStore(env.DB, user.id).recordFailure(email.subject || 'No Subject', err.message || String(err)).catch(() => {});
		}
	},
};
