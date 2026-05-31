import { describe, it, expect } from 'vitest';
import { articlePlainText } from '../src/store';

// articlePlainText hides the stored content-JSON shape (a Readability result)
// so no handler parses the content blob itself — the summarize path's old
// inline JSON.parse + tag-strip now lives here, with its own test.
describe('articlePlainText', () => {
	it('prefers the Readability textContent field', () => {
		const content = JSON.stringify({ textContent: 'plain words', content: '<p>html words</p>' });
		expect(articlePlainText(content)).toBe('plain words');
	});

	it('falls back to stripping tags from the inner HTML', () => {
		const content = JSON.stringify({ content: '<p>hello <b>there</b></p>' });
		expect(articlePlainText(content)).toBe(' hello  there  ');
	});

	it('returns empty string for null or shapeless content', () => {
		expect(articlePlainText(null)).toBe('');
		expect(articlePlainText('{}')).toBe('');
	});
});
