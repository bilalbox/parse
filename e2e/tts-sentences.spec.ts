import { test, expect } from '@playwright/test';
import { mockArticle } from './mock-article';

/**
 * The reader wraps every sentence in a `.tts-sentence` span carrying its index
 * in the playback queue. Reading the queue back out of the DOM is the only way
 * to see what the narrator will actually say, in order.
 */
async function readSentenceQueue(page: import('@playwright/test').Page): Promise<string[]> {
	return page.evaluate(() => {
		const byIndex = new Map<number, string>();
		for (const el of document.querySelectorAll<HTMLElement>('#tts-content-wrapper .tts-sentence')) {
			const idx = parseInt(el.dataset.sentenceIndex || '', 10);
			if (isNaN(idx)) continue;
			byIndex.set(idx, (byIndex.get(idx) || '') + el.textContent);
		}
		// A hole would mean an index was allocated but never rendered; surface it
		// rather than silently compacting it away.
		const max = Math.max(-1, ...byIndex.keys());
		return Array.from({ length: max + 1 }, (_, i) => byIndex.get(i) ?? '<<MISSING>>');
	});
}

async function loadReader(page: import('@playwright/test').Page, content: string): Promise<string[]> {
	await mockArticle(page, content);
	await page.goto('/article/test-article-123');
	await page.waitForSelector('.tts-sentence');
	return (await readSentenceQueue(page)).map((s) => s.trim()).filter((s) => s !== '');
}

test('a quoted paragraph is queued once, not twice', async ({ page }) => {
	// `blockquote` and the `p` inside it are both block containers, so the quote
	// used to be segmented twice and read aloud twice.
	const queue = await loadReader(
		page,
		`<p>Intro paragraph here.</p>
		<blockquote>
			<p>Quoted one. Quoted two.</p>
		</blockquote>`
	);

	expect(queue).toEqual(['Intro paragraph here.', 'Quoted one.', 'Quoted two.']);

	const nested = await page.locator('.tts-sentence .tts-sentence').count();
	expect(nested).toBe(0);
});

test('a multi-paragraph quote keeps its paragraph boundaries', async ({ page }) => {
	// Claiming the whole blockquote as one block would concatenate the two
	// unpunctuated paragraphs into "First paraSecond para".
	const queue = await loadReader(
		page,
		'<blockquote><p>First para</p><p>Second para</p></blockquote>'
	);

	expect(queue).toEqual(['First para', 'Second para']);
});

test('a list item with a nested list reads its lead-in and its children once each', async ({ page }) => {
	const queue = await loadReader(
		page,
		'<ul><li>Lead in text. <ul><li>Nested item.</li></ul></li></ul>'
	);

	expect(queue).toEqual(['Lead in text.', 'Nested item.']);
});
