import { test, expect } from '@playwright/test';
import { mockArticle } from './mock-article';

/**
 * What segmentation *produces* is covered at the module's interface in
 * `test/segmentation.spec.ts`, with no browser. What is left here is the one
 * thing that needs a live mount: the reader's attachment runs segmentation on
 * the same container twice during the initial mount alone, and a second pass
 * that failed to unwrap the first would nest the spans and shatter the text.
 */
test('a live mount leaves no nested sentence spans', async ({ page }) => {
	await mockArticle(
		page,
		`<p>Intro paragraph here.</p>
		<blockquote>
			<p>Quoted one. Quoted two.</p>
		</blockquote>`
	);
	await page.goto('/article/test-article-123');
	await page.waitForSelector('.tts-sentence');

	expect(await page.locator('.tts-sentence .tts-sentence').count()).toBe(0);

	// The queue the DOM reports is what click-to-jump and highlighting see; a
	// hole would mean an index was allocated but never rendered.
	const queue = await page.evaluate(() => {
		const byIndex = new Map<number, string>();
		for (const el of document.querySelectorAll<HTMLElement>('#tts-content-wrapper .tts-sentence')) {
			const idx = parseInt(el.dataset.sentenceIndex || '', 10);
			if (isNaN(idx)) continue;
			byIndex.set(idx, (byIndex.get(idx) || '') + el.textContent);
		}
		const max = Math.max(-1, ...byIndex.keys());
		return Array.from({ length: max + 1 }, (_, i) => byIndex.get(i) ?? '<<MISSING>>');
	});

	expect(queue.map((s) => s.trim()).filter((s) => s !== '')).toEqual([
		'Intro paragraph here.',
		'Quoted one.',
		'Quoted two.'
	]);
});
