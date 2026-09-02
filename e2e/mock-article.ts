import type { Page } from '@playwright/test';

/** Serve a fixed article body from the API so a spec can control the reader's DOM. */
export async function mockArticle(page: Page, content: string): Promise<void> {
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
