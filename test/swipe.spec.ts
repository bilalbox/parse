import { describe, expect, it } from 'vitest';
import {
	AXIS_SLOP,
	EDGE_DEAD_ZONE,
	armedAction,
	decideAxis,
	decideSwipe,
	isEdgeStart
} from '../src/lib/swipe';

const VIEWPORT = 400;
const CARD = 360;

describe('swipe gesture arbitration', () => {
	describe('the Android back gesture keeps the screen edges', () => {
		it('refuses to arm from the left edge, where back lives', () => {
			expect(isEdgeStart(EDGE_DEAD_ZONE - 1, VIEWPORT)).toBe(true);
		});

		it('refuses to arm from the right edge too — back works from either side', () => {
			expect(isEdgeStart(VIEWPORT - EDGE_DEAD_ZONE + 1, VIEWPORT)).toBe(true);
		});

		it('arms normally once the touch is clear of both edges', () => {
			expect(isEdgeStart(EDGE_DEAD_ZONE + 1, VIEWPORT)).toBe(false);
			expect(isEdgeStart(VIEWPORT / 2, VIEWPORT)).toBe(false);
		});

		it('blocks the whole gesture, not just its action, when it starts at an edge', () => {
			const back = { startX: 4, viewportWidth: VIEWPORT, dx: 300, dy: 0, cardWidth: CARD };
			expect(decideSwipe(back)).toEqual({ axis: 'blocked', action: 'none' });
		});
	});

	describe('pull-to-refresh and the card cannot both win', () => {
		it('decides nothing before the slop is exceeded', () => {
			expect(decideAxis(AXIS_SLOP - 1, AXIS_SLOP - 1)).toBe('undecided');
		});

		it('gives a clean sideways drag to the card', () => {
			expect(decideAxis(40, 5)).toBe('horizontal');
			expect(decideAxis(-40, 5)).toBe('horizontal');
		});

		it('gives a clean downward drag to pull-to-refresh', () => {
			expect(decideAxis(5, 40)).toBe('vertical');
		});

		it('gives a diagonal drag to pull-to-refresh — the tie goes to scrolling', () => {
			expect(decideAxis(30, 30)).toBe('vertical');
			expect(decideAxis(40, 30)).toBe('vertical');
		});

		it('needs horizontal to clearly dominate before the card takes the drag', () => {
			expect(decideAxis(46, 30)).toBe('horizontal');
		});

		it('never reports an action while the drag belongs to the vertical axis', () => {
			const diagonalPull = { startX: 200, viewportWidth: VIEWPORT, dx: 200, dy: 200, cardWidth: CARD };
			expect(decideSwipe(diagonalPull)).toEqual({ axis: 'vertical', action: 'none' });
		});
	});

	describe('how far a swipe must travel to commit', () => {
		it('does nothing for a short drag either way', () => {
			expect(armedAction(-40, CARD)).toBe('none');
			expect(armedAction(40, CARD)).toBe('none');
		});

		it('archives on a left swipe past a third of the card', () => {
			expect(armedAction(-CARD * 0.4, CARD)).toBe('archive');
		});

		it('makes delete travel further than archive, because it is the one that cannot be undone', () => {
			expect(armedAction(CARD * 0.4, CARD)).toBe('none');
			expect(armedAction(CARD * 0.6, CARD)).toBe('delete');
		});

		it('stays inert on a zero-width card rather than guessing', () => {
			expect(armedAction(-500, 0)).toBe('none');
		});

		it('arms delete only after the axis lock has gone to the card', () => {
			const swipe = { startX: 200, viewportWidth: VIEWPORT, dx: CARD * 0.6, dy: 8, cardWidth: CARD };
			expect(decideSwipe(swipe)).toEqual({ axis: 'horizontal', action: 'delete' });
		});
	});
});
