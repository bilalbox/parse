import DOMPurify from 'dompurify';

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

function registerSanitizeHooks(): void {
	if (hooksRegistered) return;
	hooksRegistered = true;

	DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
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

		const style = el.getAttribute('style');
		if (!style) continue;

		const filtered = filterInlineStyle(style);
		if (filtered) el.setAttribute('style', filtered);
		else el.removeAttribute('style');
	}
}

/**
 * Structural tidy for stored article bodies.
 *
 * Newsletter HTML arrives as table-layout wreckage that Readability strips
 * only partly: orphaned `<tbody>/<tr>/<td>` with no `<table>` ancestor, dozens
 * of attribute-less `<span>` wrappers, per-letter Darkreader spans, and empty
 * `<p>` elements that each collect a paragraph's worth of bottom margin. This
 * runs at render time rather than at ingest so it applies to Articles already
 * in the library, and before the element is mounted so it cannot desync the
 * `data-sentence-index` spans the narration pass stamps onto text nodes.
 */

/**
 * Elements that carry meaning even with no text of their own. `<br>` is
 * deliberately absent: an email's fake paragraph spacing is the noise being
 * removed, and treating it as content would keep every ancestor block alive.
 */
const VOID_CONTENT = 'img, hr, iframe, video, audio, picture, svg, table, input, button';

function unwrap(el: Element): void {
	const parent = el.parentNode;
	if (!parent) return;
	while (el.firstChild) parent.insertBefore(el.firstChild, el);
	parent.removeChild(el);
}

/** Table parts Readability orphaned from their `<table>` are pure noise. */
function unwrapOrphanedTableParts(root: Element): void {
	for (const el of Array.from(root.querySelectorAll('tbody, thead, tfoot, tr, td, th'))) {
		if (!el.closest('table')) unwrap(el);
	}
}

/**
 * Spans that carry nothing — no attributes, or only Darkreader's injected
 * colour hints. These are what render "TLDR" as four separate letterforms.
 */
function unwrapInertSpans(root: Element): void {
	for (const span of Array.from(root.querySelectorAll('span'))) {
		const names = span.getAttributeNames();
		const inert = names.every((n) => n.startsWith('data-darkreader'));
		if (inert) unwrap(span);
	}
}

const TEXT_NODE = 3;

/**
 * Whitespace at the edges of an anchor renders as an underlined indent — the
 * stray underscore-looking runs before a newsletter's link text.
 *
 * The whitespace is *moved outside* the anchor rather than deleted: emails
 * routinely close a link as `<a>…<strong>OpenRouter</strong> </a>gives you`,
 * where that trailing space is the only thing separating two words. Unwrapping
 * spans leaves adjacent text nodes behind, so walk inward from each end.
 */
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

		// Re-seat the whitespace as an ordinary space in the surrounding flow,
		// where it separates words without being underlined. Adjacent runs
		// collapse on render, so an extra space is never visible.
		const parent = anchor.parentNode;
		if (!parent) continue;
		if (trimmedStart) parent.insertBefore(doc.createTextNode(' '), anchor);
		if (trimmedEnd) parent.insertBefore(doc.createTextNode(' '), anchor.nextSibling);
	}
}

/** Drop blocks that hold neither text nor a meaningful void element. */
function dropEmptyBlocks(root: Element): void {
	// Innermost first, so emptying a child can empty its parent in one pass.
	const blocks = Array.from(root.querySelectorAll('p, div, section, li')).reverse();
	for (const el of blocks) {
		if (el.textContent?.trim()) continue;
		if (el.querySelector(VOID_CONTENT)) continue;
		el.remove();
	}
}

/** Runs of `<br>` are an email's way of faking paragraph spacing. */
function collapseLineBreaks(root: Element): void {
	for (const br of Array.from(root.querySelectorAll('br'))) {
		if (!br.parentNode) continue; // already swallowed by an earlier run

		// Drop every following <br>, skipping the whitespace between them, until
		// a sibling with real content ends the run.
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

/** Below this, a shared prefix is coincidence rather than a restated masthead. */
const MIN_TITLE_ECHO = 6;

/**
 * Newsletters restate their own masthead as the first heading in the body,
 * directly under the `<h1>` the reader already renders. Scoped to the first
 * heading so a legitimate section title is never at risk.
 */
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

	// A masthead is restated at the *start* of the heading ("TLDR Dev" →
	// "TLDR Dev 2026-09-01"). Plain containment would delete a real section
	// heading whose text happens to mention a short title — "Rust" inside "Why
	// Rust Ownership Matters" — and silent content loss is the worse failure.
	const shorter = a.length < b.length ? a : b;
	if (shorter.length < MIN_TITLE_ECHO) return;
	if (a.startsWith(b) || b.startsWith(a)) heading.remove();
}

/**
 * Newsletter sponsor logos ship with their white background baked into the
 * pixels, which punches a hole in the dark theme. Marking them lets CSS seat
 * them on a surface — inverting or blending would wreck brand colour.
 *
 * Email only. A web article's hero photo already fills its frame, and giving it
 * an inset grey mat would read as a rendering fault rather than a choice.
 */
function markEmailImages(root: Element): void {
	for (const img of Array.from(root.querySelectorAll('img'))) {
		img.classList.add('article-image');
	}
}

/**
 * The tidy pass, over an already-parsed root. Split from `sanitizeArticleHtml`
 * so it can be exercised against any DOM implementation — the sanitize wrapper
 * needs a browser `DOMParser`, this needs only nodes.
 */
export interface TidyOptions {
	/** Article title, used to drop a heading that merely restates it. */
	title?: string;
	/** Ingest path. Only email bodies get their images framed. */
	sourceType?: string;
}

export function tidyArticleDom(root: Element, { title = '', sourceType }: TidyOptions = {}): void {
	stripOverflowAttributes(root);
	unwrapOrphanedTableParts(root);
	unwrapInertSpans(root);
	// Unwrapping leaves adjacent text nodes; merge them so the trims below see
	// each run of whitespace as one node.
	root.normalize();
	trimAnchorWhitespace(root);
	collapseLineBreaks(root);
	dropEmptyBlocks(root);
	if (title) dropDuplicateTitleHeading(root, title);
	if (sourceType === 'email') markEmailImages(root);
}

export function sanitizeArticleHtml(html: string, options: TidyOptions = {}): string {
	if (!html) return '';

	registerSanitizeHooks();
	const clean = DOMPurify.sanitize(html);

	if (typeof window === 'undefined') return clean;

	const doc = new DOMParser().parseFromString(`<div id="sanitize-root">${clean}</div>`, 'text/html');
	const root = doc.getElementById('sanitize-root');
	if (!root) return clean;

	tidyArticleDom(root, options);
	return root.innerHTML;
}
