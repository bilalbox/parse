/**
 * Narration segmentation: turn a mounted Article container into the sentence
 * queue the narrator reads, wrapping each sentence in a `.tts-sentence` span so
 * highlighting and click-to-jump can find it.
 *
 * Nodes are created from the container's own document rather than a global
 * `document`, which is what makes this callable outside a browser.
 *
 * **The tidy pass must have run before this.** `tidyArticleDom` deletes nodes
 * (orphaned table parts, a duplicated title heading); deleting a block after
 * segmentation leaves holes in the sentence index. Under the current design the
 * ordering is automatic — tidying happens during render, segmentation after
 * mount — so nothing in the code makes the dependency visible. Moving
 * segmentation earlier to save paint time breaks sentence indices silently.
 */

/** The class the reader's stylesheet and click handler both look for. */
export const SENTENCE_CLASS = 'tts-sentence';

/** The languages narration segments for. Arabic is segmented but not narrated (ADR-0005). */
export type ContentLang = 'ar' | 'en';

export interface Sentence {
	text: string;
	/** Every span carrying part of this sentence, in document order. */
	elements: Element[];
}

/** Blocks own their own text; anything outside one is not narrated. */
const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, summary';

/** Rescued sections are lists of URLs — skipped rather than read aloud. */
const SKIP_SELECTOR = '.parsed-action-links, .parsed-rescued-images';

// `NodeFilter` is not a global in every runtime this module runs in (the test
// pool exposes it only as a package export), so use its numeric value directly.
const SHOW_TEXT = 4;

// Conservative list: titles/abbreviations that end in "." but almost never end a
// sentence (they're followed by a name/number). Kept small to avoid false merges.
const ABBREVIATIONS = new Set([
	'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'e.g', 'i.e', 'u.s'
]);

/** True if a chunk ends with a single-period abbreviation or an initial (e.g. "Mr.", "J."). */
function endsWithAbbreviation(chunk: string): boolean {
	const trimmed = chunk.trimEnd();
	// Must end in exactly one period whose preceding char is not itself a terminator
	// (rules out "...", "?." and other multi-terminator runs).
	if (!/[^.!?]\.$/.test(trimmed)) return false;
	const word = trimmed.match(/(\S+)\.$/)?.[1] ?? '';
	return /^[A-Z]$/.test(word) || ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * Locale-aware sentence segmentation via the platform ICU segmenter.
 * Returns contiguous, literal slices of `text` (they tile it exactly).
 */
function segmentSentences(text: string, locale: ContentLang): string[] {
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
		return [...segmenter.segment(text)].map((s) => s.segment);
	}
	// Fallback for environments without Intl.Segmenter: a boundary is terminal
	// punctuation followed by whitespace or end-of-text (Arabic adds ؟, ۔).
	const terminators = locale === 'ar' ? '.!?\\u061F\\u06D4' : '.!?';
	return text.match(new RegExp(`[\\s\\S]*?[${terminators}]+(?:\\s+|$)|[\\s\\S]+$`, 'g')) || [];
}

/** Re-join chunks split at a title or initial, e.g. "Mr." + "Smith said hi." */
function mergeAbbreviations(chunks: string[]): string[] {
	const merged: string[] = [];
	for (const chunk of chunks) {
		const prev = merged[merged.length - 1];
		if (prev !== undefined && endsWithAbbreviation(prev)) {
			merged[merged.length - 1] = prev + chunk;
		} else {
			merged.push(chunk);
		}
	}
	return merged;
}

/**
 * Split a block of text into sentences using the platform's locale-aware
 * segmenter, then re-join title/initial over-splits (e.g. "Mr.", "J.") for
 * English. Returns literal, contiguous slices of `text` (the span mapper relies
 * on it).
 */
function splitIntoSentences(text: string, lang: ContentLang): string[] {
	const chunks = segmentSentences(text, lang);
	return lang === 'ar' ? chunks : mergeAbbreviations(chunks);
}

/** Undo a previous pass so re-segmenting a container re-splits its text instead of its spans. */
function unwrapSentenceSpans(container: Element): void {
	// Splitting works off text-node offsets, so the shards left behind by the
	// removed spans have to be merged back into whole runs. Only the blocks that
	// held spans need it — normalizing the whole container would reach into
	// Svelte-managed regions (the summary callout) for nothing.
	const parents = new Set<Element>();
	container.querySelectorAll(`span.${SENTENCE_CLASS}`).forEach((span) => {
		const parent = span.parentElement;
		if (parent) parents.add(parent);
		span.replaceWith(...Array.from(span.childNodes));
	});
	parents.forEach((parent) => parent.normalize());
}

/**
 * The text nodes a block owns: those no *nearer* block claims. Blocks nest
 * (blockquote > p, li > ul > li), so without this a quote is segmented twice —
 * once by the blockquote, once by its paragraph — and therefore queued twice
 * and read aloud twice.
 */
function claimedTextNodes(block: Element): Text[] {
	const claimed: Text[] = [];
	const walk = block.ownerDocument.createTreeWalker(block, SHOW_TEXT, null);
	let node: Node | null;
	while ((node = walk.nextNode())) {
		if ((node as Text).parentElement?.closest(BLOCK_SELECTOR) !== block) continue;
		claimed.push(node as Text);
	}
	return claimed;
}

/**
 * Segment a mounted Article container in place and return its playback queue.
 *
 * Idempotent: re-running on an already-segmented container unwraps the previous
 * pass first, so the reader's attachment firing twice on one mount is safe.
 */
export function segmentContainer(container: Element, lang: ContentLang): Sentence[] {
	const doc = container.ownerDocument;
	const sentences: Sentence[] = [];
	let sentenceCount = 0;

	unwrapSentenceSpans(container);

	const blocks = Array.from(container.querySelectorAll(BLOCK_SELECTOR)).filter(
		(el) => !el.closest(SKIP_SELECTOR)
	);

	for (const block of blocks) {
		const textNodesInBlock = claimedTextNodes(block);

		// Must be the claimed nodes, not block.textContent: the offsets below
		// index into this string.
		const blockText = textNodesInBlock.map((n) => n.data).join('');
		// A container block (a blockquote wrapping paragraphs) is left holding
		// only inter-tag whitespace; queueing that as a sentence would put a
		// silent entry in the playback order.
		if (!blockText.trim()) continue;

		const blockSentences = splitIntoSentences(blockText, lang);
		if (blockSentences.length === 0) continue;

		// Locate each sentence's span in blockText once per block. This used to
		// re-scan from scratch for every text node (O(text nodes * sentences)),
		// which freezes the tab on link/formatting-heavy content (lots of small
		// text nodes per block, e.g. newsletters).
		// splitIntoSentences guarantees literal, contiguous slices of blockText,
		// so each sentence's start is exactly where the previous one ended.
		const sentenceBounds: { start: number; end: number }[] = [];
		let sentenceCursor = 0;
		for (const sText of blockSentences) {
			const end = sentenceCursor + sText.length;
			sentenceBounds.push({ start: sentenceCursor, end });
			sentenceCursor = end;
		}

		let textNodesOffset = 0;
		let sentenceIdx = 0;
		for (const node of textNodesInBlock) {
			const parent = node.parentElement;
			const nodeStart = textNodesOffset;
			const nodeLength = node.length;
			textNodesOffset += nodeLength;
			if (!parent) continue;

			const nodeText = node.textContent || '';
			const fragment = doc.createDocumentFragment();
			let nodeOffset = 0;

			while (nodeOffset < nodeLength) {
				const absOffset = nodeStart + nodeOffset;
				while (sentenceIdx < sentenceBounds.length && sentenceBounds[sentenceIdx].end <= absOffset) {
					sentenceIdx++;
				}
				if (sentenceIdx >= sentenceBounds.length) {
					fragment.appendChild(doc.createTextNode(nodeText.substring(nodeOffset)));
					break;
				}

				const { start: sStart, end: sEnd } = sentenceBounds[sentenceIdx];

				if (absOffset < sStart) {
					const len = Math.min(sStart - absOffset, nodeLength - nodeOffset);
					fragment.appendChild(doc.createTextNode(nodeText.substring(nodeOffset, nodeOffset + len)));
					nodeOffset += len;
				} else {
					const len = Math.min(sEnd - absOffset, nodeLength - nodeOffset);
					const matchText = nodeText.substring(nodeOffset, nodeOffset + len);

					const span = doc.createElement('span');
					span.className = SENTENCE_CLASS;
					const globalIdx = sentenceCount + sentenceIdx;
					span.dataset.sentenceIndex = globalIdx.toString();
					span.textContent = matchText;
					fragment.appendChild(span);

					if (!sentences[globalIdx]) {
						sentences[globalIdx] = { text: blockSentences[sentenceIdx], elements: [] };
					}
					sentences[globalIdx].elements.push(span);

					nodeOffset += len;
				}
			}

			parent.replaceChild(fragment, node);
		}

		sentenceCount += blockSentences.length;
	}

	return sentences;
}
