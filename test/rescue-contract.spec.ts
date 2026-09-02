import { describe, it, expect } from 'vitest';
import appCss from 'virtual:app-css';
import {
	ACTION_LINKS_CLASS,
	FEATURED_IMAGE_CLASS,
	RESCUED_IMAGES_CLASS,
	RESCUED_SECTION_SELECTOR
} from '../src/lib/rescue';
import { ACTIVE_SENTENCE_CLASS, SENTENCE_CLASS } from '../src/lib/segmentation';

describe('the Rescue class contract', () => {
	it('names the sections narration skips', () => {
		expect(RESCUED_SECTION_SELECTOR).toContain(`.${ACTION_LINKS_CLASS}`);
		expect(RESCUED_SECTION_SELECTOR).toContain(`.${RESCUED_IMAGES_CLASS}`);
	});

	it('names the section the featured image is rescued into', () => {
		expect(FEATURED_IMAGE_CLASS).toBe('featured-image-container');
	});
});

/**
 * Every other consumer of these class names imports them. The stylesheet cannot
 * — it is CSS — so it is the one place a rename can go unnoticed, taking the
 * styling of rescued links or the narration highlight with it.
 */
describe('the stylesheet still styles the classes the code writes', () => {
	for (const className of [ACTION_LINKS_CLASS, SENTENCE_CLASS, ACTIVE_SENTENCE_CLASS]) {
		it(`references .${className}`, () => {
			expect(appCss, `app.css no longer references .${className}`).toContain(`.${className}`);
		});
	}
});
