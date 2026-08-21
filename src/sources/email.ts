import { parseHTML } from 'linkedom';
import type { Source } from '../extract';

type EmailHeader = { key: string; value: string };

// Parse RFC 2369 List-Unsubscribe / RFC 8058 List-Unsubscribe-Post headers.
// Returns the preferred actionable link (https over mailto) and whether the
// sender supports automated one-click POST unsubscribe.
export function extractUnsubscribe(headers: EmailHeader[] | undefined): { link: string | null; oneClick: boolean } {
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

// Append a <details> section listing rescued items (images or links) that
// Readability dropped, under the given class and heading. `open` starts the
// section expanded — used for images, since a closed accordion of the
// article's own photos reads to the user as "images are missing".
function appendRescuedSection(
	articleDoc: any,
	className: string,
	heading: string,
	build: (section: any) => void,
	open = false,
): void {
	const section = articleDoc.createElement('details');
	section.setAttribute('class', `${className} details-collapsible`);
	if (open) section.setAttribute('open', '');
	const summary = articleDoc.createElement('summary');
	const strong = articleDoc.createElement('strong');
	strong.textContent = heading;
	summary.appendChild(strong);
	section.appendChild(summary);
	build(section);
	// Not articleDoc.body: linkedom parses a bodyless fragment (Readability's
	// output) by inserting an always-empty phantom <body>, so appending there
	// buries the section ahead of the real content instead of after it.
	articleDoc.documentElement.appendChild(section);
}

// The email ingest adapter. Wraps a PostalMime-parsed email and satisfies the
// Source seam: images resolve from cid: attachments first (else fetch), rescue
// re-attaches dropped large images and CTA links, metadata comes from the email
// headers plus the extracted unsubscribe link.
export function createEmailSource(email: any, messageId: string): Source {
	const html = email.html || email.text || '';
	const { link: unsubscribeLink, oneClick } = extractUnsubscribe(email.headers);

	return {
		html,
		baseUrl: '',

		async resolveBytes(src) {
			if (src.startsWith('cid:')) {
				const cid = src.substring(4);
				const attachment = email.attachments?.find((a: any) => a.contentId === `<${cid}>` || a.contentId === cid);
				if (!attachment) return null;
				const content = attachment.content as Uint8Array;
				const buffer = content.buffer.slice(
					content.byteOffset,
					content.byteOffset + content.byteLength,
				) as ArrayBuffer;
				return { buffer, contentType: attachment.mimeType };
			}

			const res = await fetch(new URL(src).href);
			if (!res.ok) return null;
			return {
				buffer: await res.arrayBuffer(),
				contentType: res.headers.get('content-type') || 'application/octet-stream',
			};
		},

		rescue({ articleDoc, sourceDoc }) {
			// Re-attach large images Readability dropped (e.g. inside tables).
			const originalImageSrcs = new Set<string>();
			for (const img of Array.from(sourceDoc.querySelectorAll('img')) as any[]) {
				const src = img.getAttribute('src');
				const width = parseInt(img.getAttribute('width') || '0', 10);
				const height = parseInt(img.getAttribute('height') || '0', 10);
				if (src && !isTrackingPixel(src, width, height)) {
					originalImageSrcs.add(src);
				}
			}
			const survivingImgSrcs = new Set(
				(Array.from(articleDoc.querySelectorAll('img')) as any[])
					.map((img) => img.getAttribute('src'))
					.filter((s): s is string => !!s)
					.map(normalizeImageSrc),
			);
			const missingImages = [...originalImageSrcs].filter((src) => !survivingImgSrcs.has(normalizeImageSrc(src)));
			if (missingImages.length) {
				appendRescuedSection(articleDoc, 'parsed-rescued-images', 'Images from this email', (section) => {
					for (const src of missingImages) {
						const p = articleDoc.createElement('p');
						const img = articleDoc.createElement('img');
						img.setAttribute('src', src);
						p.appendChild(img);
						section.appendChild(p);
					}
				}, true);
			}

			// Re-attach action buttons (confirm/verify links) Readability dropped,
			// only those missing from the parsed content so we don't duplicate.
			const actionLinks = extractActionLinks(sourceDoc, unsubscribeLink);
			const survivingHrefs = new Set(
				(Array.from(articleDoc.querySelectorAll('a[href]')) as any[]).map((a) => a.getAttribute('href')),
			);
			const missing = actionLinks.filter((l) => !survivingHrefs.has(l.href));
			if (missing.length) {
				appendRescuedSection(articleDoc, 'parsed-action-links', 'Links from this email', (section) => {
					for (const { href, text } of missing) {
						const p = articleDoc.createElement('p');
						const a = articleDoc.createElement('a');
						a.setAttribute('href', href);
						a.textContent = text;
						p.appendChild(a);
						section.appendChild(p);
					}
				});
			}
		},

		metadata() {
			return {
				title: email.subject || 'No Subject',
				author: email.from?.name || email.from?.address || 'Unknown Sender',
				url: `email://${messageId}`,
				sourceType: 'email',
				unsubscribeLink,
				unsubscribeOneClick: oneClick,
				published: email.date || null,
				wordCount: null,
			};
		},
	};
}
