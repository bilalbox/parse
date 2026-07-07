import { test, expect } from '@playwright/test';

// A single link-dense paragraph: many small text nodes packed into one block.
// Regression guard for prepareTtsContent() re-scanning blockText for every
// text node (O(text nodes * sentences)), which froze the UI on load.
function linkDenseHtml(links: number): string {
	let para = '<p>Sentence one starts here. ';
	for (let l = 0; l < links; l++) {
		para += `<a href="https://example.com/${l}">link ${l}</a> word `;
	}
	para += 'This is the closing sentence.</p>';
	return para;
}

async function mockArticle(page: import('@playwright/test').Page, content: string) {
	await page.route('**/api/articles/*', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: 'test-article-123',
				title: 'Perf Test Article',
				author: 'Test Author',
				url: 'https://example.com/test',
				source_type: 'web',
				unsubscribe_link: null,
				unsubscribe_one_click: 0,
				archived: 0,
				content: JSON.stringify({
					title: 'Perf Test Article',
					byline: 'Test Author',
					content
				})
			})
		});
	});
}

test('link-dense article loads without a multi-second freeze', async ({ page }) => {
	await mockArticle(page, linkDenseHtml(2000));

	const start = Date.now();
	await page.goto('/article/test-article-123');
	await page.waitForSelector('.reader-content');
	await page.waitForSelector('.tts-sentence');
	const elapsed = Date.now() - start;

	expect(elapsed).toBeLessThan(2500);
});

test('tts-sentence rewrite is deferred to a later frame, not done synchronously on mount', async ({ page }) => {
	// Prove loadArticle() actually defers via requestAnimationFrame rather than
	// racing wall-clock timing against it (the algorithmic fix alone already
	// makes even large articles fast enough that a timing-based race is flaky).
	await page.addInitScript(() => {
		(window as unknown as { __rafScheduled: boolean }).__rafScheduled = false;
		const orig = window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = (cb) => {
			(window as unknown as { __rafScheduled: boolean }).__rafScheduled = true;
			return orig(cb);
		};
	});

	await mockArticle(page, linkDenseHtml(500));
	await page.goto('/article/test-article-123');
	await page.waitForSelector('.tts-sentence');

	const wasDeferred = await page.evaluate(() => (window as unknown as { __rafScheduled: boolean }).__rafScheduled);
	expect(wasDeferred).toBe(true);
});
