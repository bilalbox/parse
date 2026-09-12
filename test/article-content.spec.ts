import { describe, it, expect, beforeAll } from 'vitest';
import { parseHTML } from 'linkedom';
import { parseArticleContent } from '../src/lib/article-content';

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		globalThis.DOMParser = parseHTML('').DOMParser as any;
	}
});

/** The shape the extraction spine stores: a Readability result, JSON-encoded. */
function stored(fields: Record<string, unknown>): string {
	return JSON.stringify(fields);
}

describe('parseArticleContent', () => {
	describe('the fields each consumer needs', () => {
		it('hands back the title the reader renders', () => {
			expect(parseArticleContent(stored({ title: 'A Headline' })).title).toBe('A Headline');
		});

		it('hands back the byline narration announces', () => {
			expect(parseArticleContent(stored({ byline: 'Jane Doe' })).byline).toBe('Jane Doe');
		});

		it('hands back the HTML the reader mounts', () => {
			expect(parseArticleContent(stored({ content: '<p>Body.</p>' })).html).toBe('<p>Body.</p>');
		});

		it('hands back the plain text, which is what the language is read from', () => {
			expect(parseArticleContent(stored({ textContent: 'Body.' })).text).toBe('Body.');
		});
	});

	describe('content shapes that reach it anyway', () => {
		it('survives content that was never stored', () => {
			expect(parseArticleContent(null)).toMatchObject({ title: '', byline: '', html: '', text: '' });
			expect(parseArticleContent(undefined).title).toBe('');
			expect(parseArticleContent('').html).toBe('');
		});

		it('survives content that is not valid JSON', () => {
			// An offline cache can hand back a truncated body; the reader should
			// render an empty Article rather than throw on mount.
			expect(parseArticleContent('{"title": "trunc').title).toBe('');
		});

		it('survives JSON that is not an object', () => {
			expect(parseArticleContent('"just a string"').title).toBe('');
			expect(parseArticleContent('null').html).toBe('');
		});

		it('survives fields of the wrong type', () => {
			expect(parseArticleContent(stored({ title: 42, content: null })).title).toBe('');
		});
	});

	describe('the content language', () => {
		it('is English for Latin-script content', () => {
			expect(parseArticleContent(stored({ title: 'A Headline', textContent: 'Body.' })).lang).toBe('en');
		});

		it('is Arabic when the body is in Arabic script', () => {
			expect(parseArticleContent(stored({ textContent: 'الجملة الأولى.' })).lang).toBe('ar');
		});

		it('is Arabic when only the title is', () => {
			// Some Arabic Articles store a title the body does not repeat.
			expect(parseArticleContent(stored({ title: 'عنوان المقال', textContent: '' })).lang).toBe('ar');
		});

		it('reads the language from the stored text, not the mounted DOM', () => {
			// This is what lets the reader decide whether to offer narration before
			// the content mounts, so the play control never flashes in and out.
			expect(parseArticleContent(stored({ textContent: 'مرحبا', content: '' })).lang).toBe('ar');
		});

		it('falls back to the HTML when no plain text was stored', () => {
			expect(parseArticleContent(stored({ content: '<p>مرحبا بالعالم.</p>' })).lang).toBe('ar');
		});

		it('is English for an empty Article', () => {
			expect(parseArticleContent(null).lang).toBe('en');
		});
	});

	describe('summary markdown presentation', () => {
		it('renders headings and bullet points from markdown summary', () => {
			const md = '# Key Takeaways\n* Point one with **bold**\n* Point two with `code`\n\nFinal thought.';
			const result = parseArticleContent(stored({ title: 'Test' }), { summary: md });
			expect(result.summaryHtml).toContain('<h1>Key Takeaways</h1>');
			expect(result.summaryHtml).toContain('<ul>');
			expect(result.summaryHtml).toContain('<li>Point one with <strong>bold</strong></li>');
			expect(result.summaryHtml).toContain('<li>Point two with <code>code</code></li>');
			expect(result.summaryHtml).toContain('<p>Final thought.</p>');
		});

		it('strips unsafe script tags from summaries', () => {
			const md = '* Valid point\n<script>alert("xss")</script>';
			const result = parseArticleContent(stored({ title: 'Test' }), { summary: md });
			expect(result.summaryHtml).not.toContain('<script>');
			expect(result.summaryHtml).toContain('Valid point');
		});

		it('returns empty string when no summary is provided', () => {
			expect(parseArticleContent(stored({ title: 'Test' })).summaryHtml).toBe('');
			expect(parseArticleContent(stored({ title: 'Test' }), { summary: null }).summaryHtml).toBe('');
		});
	});

	describe('HTML sanitization in content envelope', () => {
		it('purges unsafe tags and event handlers from HTML content', () => {
			const dirty = '<p>Safe</p><script>evil()</script><img src="x" onerror="steal()">';
			const result = parseArticleContent(stored({ content: dirty }));
			expect(result.html).toContain('<p>Safe</p>');
			expect(result.html).not.toContain('<script>');
			expect(result.html).not.toContain('onerror');
		});

		it('strips disruptive inline styling like absolute positioning and negative margins', () => {
			const styled = '<p style="position: fixed; margin-left: -50px; color: red;">Styled</p>';
			const result = parseArticleContent(stored({ content: styled }));
			expect(result.html).not.toContain('position: fixed');
			expect(result.html).not.toContain('margin-left');
			expect(result.html).toContain('color: red');
		});
	});
});
