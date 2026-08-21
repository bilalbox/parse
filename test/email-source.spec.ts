import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { createEmailSource } from '../src/sources/email';

describe('createEmailSource rescue placement', () => {
	it('appends the rescued-images section after the real article content, not before it', () => {
		const email = { html: '', headers: [], attachments: [], subject: 'Test', from: { name: 'Sender' } };
		const source = createEmailSource(email, 'msg-1');

		// sourceDoc has an image Readability would have dropped from articleDoc.
		const { document: sourceDoc } = parseHTML(
			'<table><tr><td><img src="https://cdn.example.com/photo.jpg" width="600" height="400"></td></tr></table>',
		);
		// articleDoc mirrors what parseHTML(readabilityOutput) actually produces:
		// linkedom inserts an always-empty phantom <head>/<body> ahead of the
		// real content when the fragment doesn't start with <html>.
		const { document: articleDoc } = parseHTML('<div class="page"><p>Real article text.</p></div>');

		source.rescue({ articleDoc, sourceDoc, baseUrl: '' });

		const html = articleDoc.toString();
		const rescueIdx = html.indexOf('parsed-rescued-images');
		const realContentIdx = html.indexOf('Real article text');

		expect(rescueIdx).toBeGreaterThan(-1);
		expect(realContentIdx).toBeGreaterThan(-1);
		expect(rescueIdx).toBeGreaterThan(realContentIdx);
	});

	it('renders the rescued-images section expanded, not collapsed behind a disclosure triangle', () => {
		const email = { html: '', headers: [], attachments: [], subject: 'Test', from: { name: 'Sender' } };
		const source = createEmailSource(email, 'msg-1');

		const { document: sourceDoc } = parseHTML(
			'<table><tr><td><img src="https://cdn.example.com/photo.jpg" width="600" height="400"></td></tr></table>',
		);
		const { document: articleDoc } = parseHTML('<div class="page"><p>Real article text.</p></div>');

		source.rescue({ articleDoc, sourceDoc, baseUrl: '' });

		const section = articleDoc.querySelector('.parsed-rescued-images');
		expect(section.hasAttribute('open')).toBe(true);
	});
});
