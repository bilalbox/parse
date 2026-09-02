/**
 * The Article content envelope: the one place the stored `content` blob is
 * parsed on the client.
 *
 * The extraction spine stores a Readability result as JSON on the Article, and
 * the API hands it back untouched — deliberately, since changing the response
 * shape would stale every offline-cached Article. That leaves every client
 * consumer to parse it, and each one carried its own idea of what is inside.
 * They ask here instead.
 */

/**
 * The languages Narration works in. Arabic is segmented but not narrated, and
 * no Arabic voice exists on the target devices (ADR-0001, ADR-0005).
 */
export type ContentLang = 'ar' | 'en';

/** Arabic script, which is how an Article's language is told from its text. */
const ARABIC_PATTERN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export interface ArticleContent {
	title: string;
	byline: string;
	/** The Article body, as HTML, ready to mount. */
	html: string;
	/** The body as plain text, when the extractor stored it. */
	text: string;
	/**
	 * The language narration works in: it decides the segmenter locale, which
	 * voices are usable, and whether the play control renders at all. Derived
	 * from the stored text rather than the mounted DOM, so the reader can settle
	 * it before the content paints.
	 */
	lang: ContentLang;
}

const EMPTY: ArticleContent = { title: '', byline: '', html: '', text: '', lang: 'en' };

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * Parse an Article's stored content once. Never throws: a truncated or absent
 * body — which an offline cache can produce — yields an empty Article rather
 * than a reader that fails to mount.
 */
export function parseArticleContent(stored: string | null | undefined): ArticleContent {
	if (!stored) return EMPTY;

	let parsed: unknown;
	try {
		parsed = JSON.parse(stored);
	} catch {
		return EMPTY;
	}
	if (!parsed || typeof parsed !== 'object') return EMPTY;

	const fields = parsed as Record<string, unknown>;
	const title = asString(fields.title);
	const html = asString(fields.content);
	const text = asString(fields.textContent);

	return {
		title,
		byline: asString(fields.byline),
		html,
		text,
		// Prefer the plain text; fall back to the HTML for Articles stored without it.
		lang: ARABIC_PATTERN.test(title) || ARABIC_PATTERN.test(text || html) ? 'ar' : 'en'
	};
}
