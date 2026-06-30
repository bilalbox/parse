import type { Article } from './extract';
import { extractMediaKeys } from './media';

// The Article store owns every query against the `articles` table and its FTS
// index. Column names, the archived flag, the source_type enum, and the stored
// content-JSON shape live here and nowhere else — a schema change touches one
// module, not a dozen handlers.

// A full stored row. Snake_case mirrors the schema and the JSON the frontend
// consumes, so handlers can return get()/list() results straight through.
export interface StoredArticle {
	id: string;
	title: string;
	author: string | null;
	url: string | null;
	content: string | null;
	source_type: string;
	unsubscribe_link: string | null;
	unsubscribe_one_click: number;
	archived: number;
	summary: string | null;
	created_at: string;
}

// The metadata projection the library list returns (no heavy content column).
export type ArticleListItem = Pick<
	StoredArticle,
	'id' | 'title' | 'author' | 'url' | 'unsubscribe_link' | 'archived' | 'created_at'
>;

export interface SearchHit {
	id: string;
	title: string;
	match_snippet: string;
}

// Extract plain text from a stored Article's content column for summarization.
// Hides the Readability-result JSON shape (textContent, else strip tags from
// the inner HTML) so callers never parse the content blob themselves.
export function articlePlainText(content: string | null): string {
	const parsed = JSON.parse(content || '{}');
	return parsed.textContent || parsed.content?.replace(/<[^>]+>/g, ' ') || '';
}

export interface IngestFailure {
	id: string;
	url_or_subject: string;
	error_message: string;
	created_at: string;
}

export interface ArticleStore {
	list(archived: boolean): Promise<ArticleListItem[]>;
	get(id: string): Promise<StoredArticle | null>;
	create(article: Article): Promise<void>;
	setArchived(id: string, archived: boolean): Promise<boolean>;
	saveSummary(id: string, summary: string): Promise<void>;
	remove(id: string): Promise<boolean>;
	search(query: string): Promise<SearchHit[]>;
	recordFailure(urlOrSubject: string, errorMessage: string): Promise<void>;
	listFailures(): Promise<IngestFailure[]>;
	clearFailure(id: string): Promise<void>;
}

export interface MediaStorageAdapter {
	delete(keys: string | string[]): Promise<void>;
}

export function createArticleStore(db: D1Database, userId: string, mediaBucket?: MediaStorageAdapter): ArticleStore {
	return {
		// Default library is active items; pass archived=true for the archive.
		async list(archived) {
			const res = await db.prepare(
				`SELECT id, title, author, url, unsubscribe_link, archived, created_at
				 FROM articles WHERE user_id = ? AND archived = ? ORDER BY created_at DESC LIMIT 50`
			).bind(userId, archived ? 1 : 0).all<ArticleListItem>();
			return res.results;
		},

		async get(id) {
			return db.prepare('SELECT * FROM articles WHERE id = ? AND user_id = ?').bind(id, userId).first<StoredArticle>();
		},

		// Insert a finished Article from the extraction spine. One INSERT for
		// every ingest path; created_at is set server-side.
		async create(a) {
			await db.prepare(
				`INSERT INTO articles (id, user_id, title, author, url, content, source_type, unsubscribe_link, unsubscribe_one_click, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
			).bind(
				a.id, 
				userId, 
				a.title ?? null, 
				a.author ?? null, 
				a.url ?? null, 
				a.content ?? null, 
				a.sourceType, 
				a.unsubscribeLink ?? null, 
				a.unsubscribeOneClick ? 1 : 0
			).run();
		},

		// Returns false when no such article exists (so the caller can 404).
		async setArchived(id, archived) {
			const res = await db.prepare('UPDATE articles SET archived = ? WHERE id = ? AND user_id = ?')
				.bind(archived ? 1 : 0, id, userId).run();
			return !!res.meta.changes;
		},

		async saveSummary(id, summary) {
			await db.prepare('UPDATE articles SET summary = ? WHERE id = ? AND user_id = ?').bind(summary, id, userId).run();
		},

		// Permanently removes an Article from the Library/Archive and purges
		// its associated Media. Returns true if removed, false if not found.
		async remove(id) {
			if (mediaBucket) {
				const row = await db.prepare('SELECT content FROM articles WHERE id = ? AND user_id = ?').bind(id, userId).first<{content: string | null}>();
				if (!row) return false;

				const keys = extractMediaKeys(row.content);
				if (keys.length > 0) {
					try {
						await mediaBucket.delete(keys);
					} catch (e) {
						console.error('Failed to purge R2 media for article', id, e);
					}
				}
			} else {
				const row = await db.prepare('SELECT 1 FROM articles WHERE id = ? AND user_id = ?').bind(id, userId).first();
				if (!row) return false;
			}

			await db.prepare('DELETE FROM articles WHERE id = ? AND user_id = ?').bind(id, userId).run();
			return true;
		},

		async search(query) {
			const res = await db.prepare(`
				SELECT a.id, f.title, snippet(articles_fts, -1, '<b>', '</b>', '...', 64) as match_snippet
				FROM articles_fts f
				JOIN articles a ON a.rowid = f.rowid
				WHERE f.content MATCH ? AND a.user_id = ?
				ORDER BY f.rank
				LIMIT 10
			`).bind(query, userId).all<SearchHit>();
			return res.results;
		},

		async recordFailure(urlOrSubject, errorMessage) {
			await db.prepare(
				`INSERT INTO ingest_failures (id, user_id, url_or_subject, error_message, created_at)
				 VALUES (?, ?, ?, ?, datetime('now'))`
			).bind(crypto.randomUUID(), userId, urlOrSubject, errorMessage).run();
		},

		async listFailures() {
			const res = await db.prepare(
				`SELECT id, url_or_subject, error_message, created_at
				 FROM ingest_failures WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
			).bind(userId).all<IngestFailure>();
			return res.results;
		},

		async clearFailure(id) {
			await db.prepare('DELETE FROM ingest_failures WHERE id = ? AND user_id = ?').bind(id, userId).run();
		},
	};
}
