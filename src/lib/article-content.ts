import DOMPurify from 'dompurify';

/**
 * The Article content envelope: the one place the stored `content` blob is
 * parsed, sanitized, and prepared for presentation on the client.
 *
 * The extraction spine stores a Readability result as JSON on the Article, and
 * the API hands it back untouched — deliberately, since changing the response
 * shape would stale every offline-cached Article. That leaves every client
 * consumer to parse it, and each one carried its own idea of what is inside.
 * They ask here instead.
 *
 * Absorbs DOM sanitization (DOMPurify), structural DOM tidying, and summary
 * markdown compilation, handing out safe, ready-to-mount HTML.
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
	/** The Article body, as sanitized, tidied HTML, ready to mount. */
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
	/** The markdown summary compiled and sanitized as HTML, or empty string. */
	summaryHtml: string;
}

export interface ArticleContentOptions {
	title?: string;
	sourceType?: 'web' | 'email' | string;
	summary?: string | null;
}

export interface TidyOptions {
	/** Article title, used to drop a heading that merely restates it. */
	title?: string;
	/** Ingest path. Only email bodies get their images framed. */
	sourceType?: string;
}

const EMPTY: ArticleContent = { title: '', byline: '', html: '', text: '', lang: 'en', summaryHtml: '' };

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/* --- DOMPurify hooks & style sanitization --- */

let hooksRegistered = false;

function shouldDropStyleDeclaration(prop: string, value: string): boolean {
	const normalizedProp = prop.trim().toLowerCase();
	const normalizedValue = value.trim().toLowerCase();

	if (['width', 'min-width', 'max-width', 'height', 'min-height'].includes(normalizedProp)) {
		return true;
	}

	if (normalizedProp === 'white-space' && /^(nowrap|pre|pre-line)$/.test(normalizedValue)) {
		return true;
	}

	if (normalizedProp === 'position' && /^(absolute|fixed)$/.test(normalizedValue)) {
		return true;
	}

	if (normalizedProp === 'float') {
		return true;
	}

	if (normalizedProp.startsWith('margin') && /^-/.test(normalizedValue)) {
		return true;
	}

	return false;
}

function filterInlineStyle(style: string): string {
	return style
		.split(';')
		.map((declaration) => declaration.trim())
		.filter(Boolean)
		.filter((declaration) => {
			const colon = declaration.indexOf(':');
			if (colon === -1) return true;
			const prop = declaration.slice(0, colon);
			const value = declaration.slice(colon + 1);
			return !shouldDropStyleDeclaration(prop, value);
		})
		.join('; ');
}

function getPurifier(): any {
	if (typeof window !== 'undefined') {
		const dp = DOMPurify as any;
		return dp.sanitize ? dp : typeof dp === 'function' ? dp(window) : null;
	}
	const dp = DOMPurify as any;
	if (typeof dp?.sanitize === 'function') return dp;
	return null;
}

function registerSanitizeHooks(purifier: any): void {
	if (hooksRegistered || !purifier?.addHook) return;
	hooksRegistered = true;

	purifier.addHook('uponSanitizeAttribute', (_node: any, data: any) => {
		if (data.attrName === 'width' || data.attrName === 'height') {
			data.keepAttr = false;
			return;
		}

		if (data.attrName !== 'style') return;

		const filtered = filterInlineStyle(data.attrValue);
		if (!filtered) {
			data.keepAttr = false;
			return;
		}

		data.attrValue = filtered;
	});
}

function stripOverflowAttributes(root: Element): void {
	for (const el of Array.from(root.querySelectorAll('*'))) {
		el.removeAttribute('width');
		el.removeAttribute('height');

		for (const attr of el.getAttributeNames()) {
			if (attr.toLowerCase().startsWith('on')) {
				el.removeAttribute(attr);
			}
		}

		const style = el.getAttribute('style');
		if (!style) continue;

		const filtered = filterInlineStyle(style);
		if (filtered) el.setAttribute('style', filtered);
		else el.removeAttribute('style');
	}
}

/* --- Structural DOM Tidying --- */

const VOID_CONTENT = 'img, hr, iframe, video, audio, picture, svg, table, input, button';
const TEXT_NODE = 3;
const MIN_TITLE_ECHO = 6;

function unwrap(el: Element): void {
	const parent = el.parentNode;
	if (!parent) return;
	while (el.firstChild) parent.insertBefore(el.firstChild, el);
	parent.removeChild(el);
}

function unwrapOrphanedTableParts(root: Element): void {
	for (const el of Array.from(root.querySelectorAll('tbody, thead, tfoot, tr, td, th'))) {
		if (!el.closest('table')) unwrap(el);
	}
}

function unwrapInertSpans(root: Element): void {
	for (const span of Array.from(root.querySelectorAll('span'))) {
		const names = span.getAttributeNames();
		const inert = names.every((n) => n.startsWith('data-darkreader'));
		if (inert) unwrap(span);
	}
}

function trimAnchorWhitespace(root: Element): void {
	for (const anchor of Array.from(root.querySelectorAll('a'))) {
		const doc = anchor.ownerDocument;
		if (!doc) continue;

		let trimmedStart = false;
		for (let node = anchor.firstChild; node && node.nodeType === TEXT_NODE; ) {
			const text = node.textContent ?? '';
			const rest = text.trimStart();
			if (rest !== text) trimmedStart = true;
			node.textContent = rest;
			if (rest) break;
			node = node.nextSibling;
		}

		let trimmedEnd = false;
		for (let node = anchor.lastChild; node && node.nodeType === TEXT_NODE; ) {
			const text = node.textContent ?? '';
			const rest = text.trimEnd();
			if (rest !== text) trimmedEnd = true;
			node.textContent = rest;
			if (rest) break;
			node = node.previousSibling;
		}

		const parent = anchor.parentNode;
		if (!parent) continue;
		if (trimmedStart) parent.insertBefore(doc.createTextNode(' '), anchor);
		if (trimmedEnd) parent.insertBefore(doc.createTextNode(' '), anchor.nextSibling);
	}
}

function dropEmptyBlocks(root: Element): void {
	const blocks = Array.from(root.querySelectorAll('p, div, section, li')).reverse();
	for (const el of blocks) {
		if (el.textContent?.trim()) continue;
		if (el.querySelector(VOID_CONTENT)) continue;
		el.remove();
	}
}

function collapseLineBreaks(root: Element): void {
	for (const br of Array.from(root.querySelectorAll('br'))) {
		if (!br.parentNode) continue;

		for (;;) {
			let next = br.nextSibling;
			while (next && next.nodeType === TEXT_NODE && !next.textContent?.trim()) next = next.nextSibling;
			if (!next || (next as Element).tagName !== 'BR') break;
			next.parentNode?.removeChild(next);
		}
	}
}

function normalizeHeading(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function dropDuplicateTitleHeading(root: Element, title: string): void {
	const heading = root.querySelector('h1, h2, h3');
	if (!heading) return;

	const a = normalizeHeading(heading.textContent ?? '');
	const b = normalizeHeading(title);
	if (!a || !b) return;

	if (a === b) {
		heading.remove();
		return;
	}

	const shorter = a.length < b.length ? a : b;
	if (shorter.length < MIN_TITLE_ECHO) return;
	if (a.startsWith(b) || b.startsWith(a)) heading.remove();
}

function markEmailImages(root: Element): void {
	for (const img of Array.from(root.querySelectorAll('img'))) {
		img.classList.add('article-image');
	}
}

/**
 * The tidy pass, over an already-parsed root. Split from sanitizeArticleHtml
 * so it can be exercised against any DOM implementation.
 */
export function tidyArticleDom(root: Element, { title = '', sourceType }: TidyOptions = {}): void {
	for (const s of Array.from(root.querySelectorAll('script'))) {
		s.remove();
	}
	stripOverflowAttributes(root);
	unwrapOrphanedTableParts(root);
	unwrapInertSpans(root);
	root.normalize();
	trimAnchorWhitespace(root);
	collapseLineBreaks(root);
	dropEmptyBlocks(root);
	if (title) dropDuplicateTitleHeading(root, title);
	if (sourceType === 'email') markEmailImages(root);
}

/**
 * Sanitize and tidy article HTML.
 */
export function sanitizeArticleHtml(html: string, options: TidyOptions = {}): string {
	if (!html) return '';

	const purifier = getPurifier();
	let clean = html;
	if (purifier?.sanitize) {
		registerSanitizeHooks(purifier);
		clean = purifier.sanitize(html);
	}

	const parserClass = typeof DOMParser !== 'undefined' ? DOMParser : (globalThis as any).DOMParser;
	if (!parserClass) return clean;

	try {
		const doc = new parserClass().parseFromString(`<div id="sanitize-root">${clean}</div>`, 'text/html');
		const root = doc.getElementById('sanitize-root');
		if (!root) return clean;

		tidyArticleDom(root, options);
		return root.innerHTML;
	} catch {
		return clean;
	}
}

/**
 * Markdown summary parser for AI-generated summaries.
 */
export function renderSummaryMarkdown(summaryText: string): string {
	if (!summaryText) return '';

	const lines = summaryText.split('\n');
	let html = '';
	let inList = false;

	function parseInlineMarkdown(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>')
			.replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>')
			.replace(/&lt;code&gt;/g, '<code>').replace(/&lt;\/code&gt;/g, '</code>')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/__(.+?)__/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/_(.+?)_/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code>$1</code>');
	}

	for (const line of lines) {
		const trimmed = line.trim();

		const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			if (inList) {
				html += '</ul>';
				inList = false;
			}
			const level = headingMatch[1].length;
			const text = headingMatch[2];
			const formattedText = parseInlineMarkdown(text);
			html += `<h${level}>${formattedText}</h${level}>`;
			continue;
		}

		const bulletMatch = trimmed.match(/^[\*\-\+]\s+(.+)$/);
		if (bulletMatch) {
			if (!inList) {
				html += '<ul>';
				inList = true;
			}
			const text = bulletMatch[1];
			const formattedText = parseInlineMarkdown(text);
			html += `<li>${formattedText}</li>`;
			continue;
		}

		if (trimmed === '') {
			if (inList) {
				html += '</ul>';
				inList = false;
			}
			continue;
		}

		if (inList) {
			html += '</ul>';
			inList = false;
		}
		const formattedText = parseInlineMarkdown(trimmed);
		html += `<p>${formattedText}</p>`;
	}

	if (inList) {
		html += '</ul>';
	}

	return html;
}

/**
 * Parse an Article's stored content once. Never throws: a truncated or absent
 * body — which an offline cache can produce — yields an empty Article rather
 * than a reader that fails to mount.
 *
 * Hands out sanitized, tidied HTML ready to mount, along with language,
 * metadata, and compiled summary HTML if options.summary is provided.
 */
export function parseArticleContent(
	stored: string | null | undefined,
	options?: ArticleContentOptions
): ArticleContent {
	if (!stored) {
		let summaryHtml = '';
		if (options?.summary) {
			summaryHtml = sanitizeArticleHtml(renderSummaryMarkdown(options.summary));
		}
		return { ...EMPTY, summaryHtml };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stored);
	} catch {
		let summaryHtml = '';
		if (options?.summary) {
			summaryHtml = sanitizeArticleHtml(renderSummaryMarkdown(options.summary));
		}
		return { ...EMPTY, summaryHtml };
	}
	if (!parsed || typeof parsed !== 'object') {
		let summaryHtml = '';
		if (options?.summary) {
			summaryHtml = sanitizeArticleHtml(renderSummaryMarkdown(options.summary));
		}
		return { ...EMPTY, summaryHtml };
	}

	const fields = parsed as Record<string, unknown>;
	const title = asString(fields.title) || options?.title || '';
	const rawHtml = asString(fields.content);
	const text = asString(fields.textContent);

	const html = sanitizeArticleHtml(rawHtml, {
		title,
		sourceType: options?.sourceType
	});

	let summaryHtml = '';
	if (options?.summary) {
		summaryHtml = sanitizeArticleHtml(renderSummaryMarkdown(options.summary));
	}

	return {
		title,
		byline: asString(fields.byline),
		html,
		text,
		// Prefer the plain text; fall back to the HTML for Articles stored without it.
		lang: ARABIC_PATTERN.test(title) || ARABIC_PATTERN.test(text || html) ? 'ar' : 'en',
		summaryHtml
	};
}
