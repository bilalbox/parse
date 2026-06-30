import { test, expect } from '@playwright/test';

const WIDE_HTML = `
	<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.</p>
	<table width="800" style="width: 800px; max-width: 1000px;">
		<tr><th>Col 1</th><th>Col 2</th></tr>
		<tr><td style="width: 800px;">This is a very long text inside a table cell that will definitely exceed the mobile viewport if not constrained by CSS rules. It just keeps going and going and going and going and going and going.</td><td>Data</td></tr>
	</table>
	<pre style="width: 900px"><code>long pre block with no spaces: ${'x'.repeat(200)}</code></pre>
	<img src="https://via.placeholder.com/1000x500.png?text=Wide+Image" width="1000" style="width: 1000px">
`;

test.describe('Article Layout', () => {
	test('content does not cause horizontal scroll', async ({ page }) => {
		// Mock the API endpoint that loads the article
		await page.route('**/api/articles/*', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'test-article-123',
					title: 'Layout Test Article',
					author: 'Test Author',
					url: 'https://example.com/test',
					source_type: 'web',
					unsubscribe_link: null,
					unsubscribe_one_click: 0,
					archived: 0,
					content: JSON.stringify({
						title: 'Layout Test Article',
						byline: 'Test Author',
						content: WIDE_HTML
					})
				})
			});
		});

		// Navigate to the test article page
		await page.goto('/article/test-article-123');

		// Wait for the reader-content to be visible (loading finished)
		await page.waitForSelector('.reader-content');

		// Wait a moment for any CSS transitions or layout thrashing to settle
		await page.waitForTimeout(500);

		// Assert that the page's scrollWidth does not exceed the innerWidth
		// i.e., there is no horizontal scrolling possible
		const hasHorizontalScroll = await page.evaluate(() => {
			return document.documentElement.scrollWidth > window.innerWidth;
		});

		expect(hasHorizontalScroll).toBe(false);
	});
});
