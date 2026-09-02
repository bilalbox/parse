import { test, expect } from '@playwright/test';
import { mockArticle } from './mock-article';

/**
 * What segmentation *produces* is covered at the module's interface in
 * `test/segmentation.spec.ts`, with no browser — including this Article's queue.
 * What is left here is the one thing that needs a live mount: the reader's
 * attachment runs segmentation on the same container twice during the initial
 * mount alone, and a second pass that failed to unwrap the first would nest the
 * spans and shatter the text.
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
});
