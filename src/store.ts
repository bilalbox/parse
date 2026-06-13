import type { Article } from './extract';

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
	url: string;
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

export interface ArticleStore {
	list(archived: boolean): Promise<ArticleListItem[]>;
	get(id: string): Promise<StoredArticle | null>;
	create(article: Article): Promise<void>;
	setArchived(id: string, archived: boolean): Promise<boolean>;
	saveSummary(id: string, summary: string): Promise<void>;
	remove(id: string): Promise<void>;
	search(query: string): Promise<SearchHit[]>;
}

export function createArticleStore(db: D1Database): ArticleStore {
	return {
		// Default library is active items; pass archived=true for the archive.
		async list(archived) {
			const res = await db.prepare(
				`SELECT id, title, author, url, unsubscribe_link, archived, created_at
				 FROM articles WHERE archived = ? ORDER BY created_at DESC LIMIT 50`
			).bind(archived ? 1 : 0).all<ArticleListItem>();
			return res.results;
		},

		async get(id) {
			return db.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first<StoredArticle>();
		},

		// Insert a finished Article from the extraction spine. One INSERT for
		// every ingest path; created_at is set server-side.
		async create(a) {
			await db.prepare(
				`INSERT INTO articles (id, title, author, url, content, source_type, unsubscribe_link, unsubscribe_one_click, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
			).bind(a.id, a.title, a.author, a.url, a.content, a.sourceType, a.unsubscribeLink, a.unsubscribeOneClick ? 1 : 0).run();
		},

		// Returns false when no such article exists (so the caller can 404).
		async setArchived(id, archived) {
			const res = await db.prepare('UPDATE articles SET archived = ? WHERE id = ?')
				.bind(archived ? 1 : 0, id).run();
			return !!res.meta.changes;
		},

		async saveSummary(id, summary) {
			await db.prepare('UPDATE articles SET summary = ? WHERE id = ?').bind(summary, id).run();
		},

		// Drops the row; FTS cleanup runs via trigger. Media purge is the
		// caller's responsibility (it owns the R2 binding).
		async remove(id) {
			await db.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();
		},

		async search(query) {
			const res = await db.prepare(`
				SELECT a.id, f.title, snippet(articles_fts, -1, '<b>', '</b>', '...', 64) as match_snippet
				FROM articles_fts f
				JOIN articles a ON a.rowid = f.rowid
				WHERE f.content MATCH ?
				ORDER BY f.rank
				LIMIT 10
			`).bind(query).all<SearchHit>();
			return res.results;
		},
	};
}
