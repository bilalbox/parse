import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { SENTENCE_CLASS, segmentContainer, type Sentence } from '../src/lib/segmentation';

/** Parse a fragment and hand back its root, the way the reader hands over its mounted content. */
function container(html: string): Element {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	return document.getElementById('root') as unknown as Element;
}

/** The playback queue as text, which is what a listener actually hears. */
function queue(sentences: Sentence[]): string[] {
	return sentences.map((s) => s.text.trim()).filter((s) => s !== '');
}

/**
 * The queue as the DOM reports it. The spans are the only channel through which
 * click-to-jump and highlighting see the queue, so they have to agree with it.
 */
function queueFromSpans(root: Element): string[] {
	const byIndex = new Map<number, string>();
	for (const el of Array.from(root.querySelectorAll(`span.${SENTENCE_CLASS}`))) {
		const idx = parseInt((el as HTMLElement).dataset.sentenceIndex || '', 10);
		if (isNaN(idx)) continue;
		byIndex.set(idx, (byIndex.get(idx) || '') + el.textContent);
	}
	const max = Math.max(-1, ...byIndex.keys());
	// A hole means an index was allocated but never rendered; surface it.
	return Array.from({ length: max + 1 }, (_, i) => byIndex.get(i) ?? '<<MISSING>>');
}

describe('segmentContainer', () => {
	it('runs on the platform ICU segmenter, not the regex fallback', () => {
		// The fallback exists for environments without it. If the test pool were one
		// of those, every case below would be measuring the wrong implementation.
		expect('Segmenter' in Intl).toBe(true);
	});

	describe('what gets queued', () => {
		it('splits a paragraph into its sentences', () => {
			const root = container('<p>First one. Second one!</p>');

			expect(queue(segmentContainer(root, 'en'))).toEqual(['First one.', 'Second one!']);
		});

		it('queues a quoted paragraph once, not twice', () => {
			// `blockquote` and the `p` inside it are both block containers, so the
			// quote used to be segmented twice and read aloud twice.
			const root = container(
				'<p>Intro paragraph here.</p><blockquote><p>Quoted one. Quoted two.</p></blockquote>'
			);

			expect(queue(segmentContainer(root, 'en'))).toEqual([
				'Intro paragraph here.',
				'Quoted one.',
				'Quoted two.'
			]);
			expect(root.querySelectorAll(`.${SENTENCE_CLASS} .${SENTENCE_CLASS}`)).toHaveLength(0);
		});

		it('keeps the paragraph boundaries inside a multi-paragraph quote', () => {
			// Claiming the whole blockquote as one block would concatenate the two
			// unpunctuated paragraphs into "First paraSecond para".
			const root = container('<blockquote><p>First para</p><p>Second para</p></blockquote>');

			expect(queue(segmentContainer(root, 'en'))).toEqual(['First para', 'Second para']);
		});

		it('reads a list item lead-in and its nested children once each', () => {
			const root = container('<ul><li>Lead in text. <ul><li>Nested item.</li></ul></li></ul>');

			expect(queue(segmentContainer(root, 'en'))).toEqual(['Lead in text.', 'Nested item.']);
		});

		it('queues headings and summaries alongside prose', () => {
			const root = container('<h2>A heading</h2><details><summary>Open me</summary></details><p>Body.</p>');

			expect(queue(segmentContainer(root, 'en'))).toEqual(['A heading', 'Open me', 'Body.']);
		});

		it('skips rescued image and link sections', () => {
			// A rescued section is a list of URLs; reading it aloud is noise.
			const root = container(
				'<p>Real prose.</p>' +
					'<div class="parsed-rescued-images"><p>Images from this email</p></div>' +
					'<div class="parsed-action-links"><p>Links from this email</p></div>'
			);

			expect(queue(segmentContainer(root, 'en'))).toEqual(['Real prose.']);
		});

		it('leaves no silent entry for a block holding only whitespace', () => {
			// A blockquote wrapping paragraphs is left holding only inter-tag
			// whitespace; queueing that would put a silent gap in the playback order.
			const root = container('<p>   </p><p></p><blockquote>\n\t<p>Only real text.</p>\n</blockquote>');

			const sentences = segmentContainer(root, 'en');
			expect(sentences).toHaveLength(1);
			expect(sentences[0].text.trim()).toBe('Only real text.');
		});

		it('returns an empty queue for a container with no blocks', () => {
			expect(segmentContainer(container('<div>bare text</div>'), 'en')).toEqual([]);
		});
	});

	describe('abbreviations', () => {
		it('keeps a title attached to the name that follows it', () => {
			const root = container('<p>Mr. Smith said hi. Then he left.</p>');

			expect(queue(segmentContainer(root, 'en'))).toEqual(['Mr. Smith said hi.', 'Then he left.']);
		});

		it('keeps a single-letter initial attached to its sentence', () => {
			const root = container('<p>We met J. Smith today. It went well.</p>');

			expect(queue(segmentContainer(root, 'en'))).toEqual(['We met J. Smith today.', 'It went well.']);
		});

		it('does not merge across a real sentence end', () => {
			const root = container('<p>It ended here... And began again.</p>');

			expect(queue(segmentContainer(root, 'en'))).toEqual(['It ended here...', 'And began again.']);
		});

		it('leaves Arabic text unmerged', () => {
			// The abbreviation list is English titles; applying it to Arabic would
			// merge on a period that is a genuine boundary there.
			const root = container('<p>الجملة الأولى. الجملة الثانية.</p>');

			expect(queue(segmentContainer(root, 'ar'))).toHaveLength(2);
		});
	});

	describe('the spans it writes', () => {
		it('indexes every span so the DOM and the queue agree', () => {
			const root = container('<p>One here. Two here.</p><p>Three here.</p>');

			const sentences = segmentContainer(root, 'en');
			expect(queueFromSpans(root).map((s) => s.trim())).toEqual(
				sentences.map((s) => s.text.trim())
			);
		});

		it('hands back the spans that carry each sentence, in document order', () => {
			// A sentence broken across a link spans several elements; highlighting
			// needs all of them.
			const root = container('<p>Go <a href="https://example.com">read this</a> now. Next.</p>');

			const sentences = segmentContainer(root, 'en');
			expect(sentences[0].elements.length).toBeGreaterThan(1);
			expect(sentences[0].elements.map((el) => el.textContent).join('').trim()).toBe('Go read this now.');
		});

		it('leaves the container text unchanged', () => {
			const root = container('<p>Go <a href="https://example.com">read this</a> now. Next.</p>');
			const before = root.textContent;

			segmentContainer(root, 'en');

			expect(root.textContent).toBe(before);
		});
	});

	describe('re-running on a container it already segmented', () => {
		it('produces the same queue rather than shattering the text', () => {
			// The reader's attachment re-runs on the same container twice during the
			// initial mount alone.
			const root = container('<p>First one. Second one.</p><blockquote><p>Quoted here.</p></blockquote>');

			const first = queue(segmentContainer(root, 'en'));
			const second = queue(segmentContainer(root, 'en'));

			expect(second).toEqual(first);
		});

		it('leaves no nested spans behind', () => {
			const root = container('<p>Go <a href="https://example.com">read this</a> now. Next.</p>');

			segmentContainer(root, 'en');
			segmentContainer(root, 'en');
			segmentContainer(root, 'en');

			expect(root.querySelectorAll(`.${SENTENCE_CLASS} .${SENTENCE_CLASS}`)).toHaveLength(0);
		});

		it('hands back the live spans, not the ones the previous pass left', () => {
			const root = container('<p>First one. Second one.</p>');

			segmentContainer(root, 'en');
			const sentences = segmentContainer(root, 'en');

			for (const el of sentences[0].elements) {
				expect(root.contains(el)).toBe(true);
			}
		});
	});

	describe('the document it builds nodes from', () => {
		it('uses the container own document, never a global one', () => {
			// This is the whole of what makes the module callable outside a browser.
			const root = container('<p>One sentence here.</p>');
			const span = root.querySelector('p');

			segmentContainer(root, 'en');

			const created = root.querySelector(`span.${SENTENCE_CLASS}`)!;
			expect(created.ownerDocument).toBe(span!.ownerDocument);
		});
	});
});
