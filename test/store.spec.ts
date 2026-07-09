import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { articlePlainText, createArticleStore } from '../src/store';

// articlePlainText hides the stored content-JSON shape (a Readability result)
// so no handler parses the content blob itself — the summarize path's old
// inline JSON.parse + tag-strip now lives here, with its own test.
describe('articlePlainText', () => {
	it('prefers the Readability textContent field', () => {
		const content = JSON.stringify({ textContent: 'plain words', content: '<p>html words</p>' });
		expect(articlePlainText(content)).toBe('plain words');
	});

	it('falls back to stripping tags from the inner HTML', () => {
		const content = JSON.stringify({ content: '<p>hello <b>there</b></p>' });
		expect(articlePlainText(content)).toBe(' hello  there  ');
	});

	it('returns empty string for null or shapeless content', () => {
		expect(articlePlainText(null)).toBe('');
		expect(articlePlainText('{}')).toBe('');
	});
});

describe('ArticleStore', () => {
	it('can insert and search articles', async () => {
		const statements = [
			`DROP TABLE IF EXISTS articles`,
			`CREATE TABLE articles (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				title TEXT NOT NULL,
				author TEXT,
				url TEXT,
				content JSON,
				source_type TEXT DEFAULT 'web',
				unsubscribe_link TEXT,
				unsubscribe_one_click INTEGER DEFAULT 0,
				archived INTEGER DEFAULT 0,
				summary TEXT,
				published TEXT,
				word_count INTEGER,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE VIRTUAL TABLE articles_fts USING fts5(
				title,
				author,
				content,
				content='articles',
				content_rowid='rowid'
			)`,
			`CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
			  INSERT INTO articles_fts(rowid, title, author, content) 
			  VALUES (new.rowid, new.title, new.author, new.content);
			END`
		];
		for (const s of statements) {
			await env.DB.prepare(s).run();
		}

		const store = createArticleStore(env.DB, 'test-user');
		
		await store.create({
			id: 'test-123',
			title: 'A Test Article',
			author: 'Jane Doe',
			url: 'https://example.com/test',
			content: JSON.stringify({ content: '<p>The quick brown fox jumps over the lazy dog.</p>', textContent: 'The quick brown fox jumps over the lazy dog.' }),
			sourceType: 'web',
			unsubscribeLink: null,
			unsubscribeOneClick: false,
			published: null,
			wordCount: null,
		});

		const hits = await store.search('brown fox');
		expect(hits.length).toBe(1);
		expect(hits[0].id).toBe('test-123');
		expect(hits[0].title).toBe('A Test Article');
	});
});
