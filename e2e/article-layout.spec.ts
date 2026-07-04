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

const EMAIL_OVERFLOW_HTML = `
	<div style="min-width: 640px; white-space: nowrap;">
		<p style="white-space: nowrap;">This is a newsletter paragraph that refuses to wrap because of inline nowrap styling and should still fit inside the reader viewport without horizontal scrolling.</p>
		<table width="600" style="width: 600px; min-width: 600px;">
			<tr>
				<td style="width: 300px; white-space: nowrap;">Left column with a very long unbroken marketing headline that should wrap on mobile</td>
				<td style="width: 300px;">Right column content</td>
			</tr>
		</table>
		<p><a href="https://example.com/track?token=${'a'.repeat(120)}">https://example.com/track?token=${'a'.repeat(120)}</a></p>
	</div>
`;

async function mockArticle(page: import('@playwright/test').Page, content: string) {
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
					content
				})
			})
		});
	});
}

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
	const overflow = await page.evaluate(() => {
		const reader = document.querySelector('.reader-content');
		if (!reader) return { pageOverflow: true, readerOverflow: true, offenders: ['missing .reader-content'] };

		const readerRect = reader.getBoundingClientRect();
		const viewportRight = document.documentElement.clientWidth;
		const offenders: string[] = [];

		if (reader.scrollWidth > reader.clientWidth + 1) {
			offenders.push('.reader-content');
		}

		for (const el of Array.from(reader.querySelectorAll('*'))) {
			if (el.closest('pre')) continue;
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) continue;
			if (rect.right > viewportRight + 1 || rect.right > readerRect.right + 1) {
				offenders.push(`${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`);
			}
		}

		return {
			pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
			readerOverflow: reader.scrollWidth > reader.clientWidth + 1,
			offenders,
			hostileStyles: Array.from(document.querySelectorAll('.article-body [style]'))
				.map((el) => el.getAttribute('style') || '')
				.filter((style) => /min-width|white-space:\s*nowrap|width:\s*\d/i.test(style))
		};
	});

	expect(overflow.pageOverflow, `page overflow; offenders: ${overflow.offenders.join(', ')}`).toBe(false);
	expect(overflow.readerOverflow, `reader overflow; offenders: ${overflow.offenders.join(', ')}`).toBe(false);
	expect(overflow.offenders).toEqual([]);
	return overflow;
}

test.describe('Article Layout', () => {
	test.use({ viewport: { width: 412, height: 915 } });

	test('content does not cause horizontal scroll', async ({ page }) => {
		await mockArticle(page, WIDE_HTML);
		await page.goto('/article/test-article-123');
		await page.waitForSelector('.reader-content');
		await page.waitForTimeout(500);
		await assertNoHorizontalOverflow(page);
	});

	test('email-style nowrap and min-width content stays within viewport', async ({ page }) => {
		await mockArticle(page, EMAIL_OVERFLOW_HTML);
		await page.goto('/article/test-article-123');
		await page.waitForSelector('.reader-content');
		await page.waitForTimeout(500);
		const overflow = await assertNoHorizontalOverflow(page);
		expect(overflow.hostileStyles).toEqual([]);
	});
});
