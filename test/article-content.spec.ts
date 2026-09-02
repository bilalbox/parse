import { describe, it, expect } from 'vitest';
import { parseArticleContent } from '../src/lib/article-content';

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
});
