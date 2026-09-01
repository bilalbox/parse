import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { tidyArticleDom } from '../src/lib/sanitize-email';

/** Parse a fragment, tidy it, and hand back the root for assertions. */
function tidy(html: string, title = ''): Element {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const root = document.getElementById('root') as unknown as Element;
	tidyArticleDom(root, title);
	return root;
}

describe('tidyArticleDom', () => {
	it('unwraps table parts Readability orphaned from their table', () => {
		const root = tidy('<div><tbody><tr><td><p>Real text.</p></td></tr></tbody></div>');

		expect(root.querySelectorAll('tbody, tr, td')).toHaveLength(0);
		expect(root.textContent).toContain('Real text.');
	});

	it('keeps table parts that still have a real table around them', () => {
		const root = tidy('<table><tbody><tr><td>Cell</td></tr></tbody></table>');

		expect(root.querySelectorAll('td')).toHaveLength(1);
	});

	it('unwraps the per-letter Darkreader spans that shatter a masthead', () => {
		// This is the shape that rendered TLDR's masthead as "T L D R".
		const root = tidy(
			'<p><span data-darkreader-inline-color="">T</span><span><span data-darkreader-inline-color="">L</span>' +
				'<span data-darkreader-inline-color="">D</span></span><span data-darkreader-inline-color="">R</span></p>'
		);

		expect(root.querySelectorAll('span')).toHaveLength(0);
		expect(root.textContent).toBe('TLDR');
	});

	it('keeps spans that carry an attribute of their own', () => {
		const root = tidy('<p><span id="date">2026-09-01</span></p>');

		expect(root.querySelectorAll('span')).toHaveLength(1);
	});

	it('trims whitespace inside anchors, including across unwrapped spans', () => {
		// Email source indents link contents; that indent renders as an
		// underlined run before the link text.
		const root = tidy('<p><a href="https://example.com">\n     <span>\n   <strong>Sponsor</strong></span>\n</a></p>');

		const anchor = root.querySelector('a') as Element;
		expect(anchor.textContent).toBe('Sponsor');
	});

	it('re-seats edge whitespace outside the anchor instead of deleting it', () => {
		// That trailing space is the only thing separating two words; dropping it
		// renders "OpenRoutergives you".
		const root = tidy('<p><a href="https://example.com"><strong>OpenRouter</strong> </a>gives you a unified API.</p>');

		expect(root.querySelector('a')?.textContent).toBe('OpenRouter');
		expect(root.textContent).toBe('OpenRouter gives you a unified API.');
	});

	it('drops empty blocks, including ones whose only content is a line break', () => {
		const root = tidy('<div><p></p><p>   </p><p><br></p><p>Kept.</p></div>');

		expect(root.querySelectorAll('p')).toHaveLength(1);
		expect(root.textContent?.trim()).toBe('Kept.');
	});

	it('does not drop a block that only holds an image', () => {
		const root = tidy('<p><img src="/media/abc.png"></p>');

		expect(root.querySelectorAll('img')).toHaveLength(1);
	});

	it('collapses a run of line breaks used to fake paragraph spacing', () => {
		const root = tidy('<p>One<br><br><br>Two</p>');

		expect(root.querySelectorAll('br')).toHaveLength(1);
	});

	it('drops a leading heading that restates the article title', () => {
		const root = tidy('<h2>TLDR Dev 2026-09-01</h2><h2>Articles &amp; Tutorials</h2>', 'TLDR Dev');

		const headings = [...root.querySelectorAll('h2')].map((h) => h.textContent);
		expect(headings).toEqual(['Articles & Tutorials']);
	});

	it('leaves the first heading alone when it is a real section title', () => {
		const root = tidy('<h2>Articles &amp; Tutorials</h2>', 'TLDR Dev');

		expect(root.querySelectorAll('h2')).toHaveLength(1);
	});

	it('marks images so CSS can seat a white sponsor logo on a surface', () => {
		const root = tidy('<p><img src="/media/logo.png" alt="OpenRouter"></p>');

		expect(root.querySelector('img')?.classList.contains('article-image')).toBe(true);
	});

	it('preserves every link and all readable text', () => {
		const root = tidy(
			'<div><tbody><tr><td><p><span></span></p>' +
				'<p><a href="https://a.example"> One </a> and <a href="https://b.example">Two</a></p>' +
				'</td></tr></tbody></div>'
		);

		expect(root.querySelectorAll('a')).toHaveLength(2);
		expect(root.textContent?.replace(/\s+/g, ' ').trim()).toBe('One and Two');
	});
});
