/**
 * Gesture arbitration for the library's swipe actions.
 *
 * A card swipe shares the screen with two gestures it must never steal:
 * Android's edge-swipe back, and pull-to-refresh. Both guarantees live here as
 * pure decisions so they can be tested without a device.
 *
 * Back is protected by refusing to arm inside the screen-edge margin the system
 * owns. Pull-to-refresh is protected by a single axis lock that the card *and*
 * `PullToRefresh` both consult: one rule, two callers, so a drag can pull or
 * swipe but never both. Coordinating instead by swallowing the event (a card
 * calling `stopPropagation`) would leave the other handler mid-gesture with no
 * touchend, and its stale state would corrupt the next drag.
 */

/**
 * Android 10+ reserves a margin at each screen edge for the system back
 * gesture. A drag starting there is consumed — or handed to the WebView and
 * then cancelled halfway — before we can act on it, and a swipe that dies
 * mid-flight reads worse than no swipe at all. Both edges: back works from either.
 */
export const EDGE_DEAD_ZONE = 28;

/** Movement, in px, before a drag is committed to an axis. */
export const AXIS_SLOP = 10;

/**
 * How decisively horizontal must beat vertical to take the lock. Scrolling is
 * the dominant gesture in a list, so the tie goes to vertical: a wrongly-armed
 * swipe costs more than a wrongly-ignored one.
 */
export const AXIS_BIAS = 1.5;

/**
 * Fractions of card width at which each action arms. Delete sits deliberately
 * further out than archive — archive is reversible, delete takes the images with it.
 */
export const ARCHIVE_FRACTION = 0.35;
export const DELETE_FRACTION = 0.55;

/** `blocked` means the drag started somewhere we refuse to own (a screen edge). */
export type SwipeAxis = 'blocked' | 'undecided' | 'horizontal' | 'vertical';
export type SwipeAction = 'none' | 'archive' | 'delete';

export interface SwipeInput {
	startX: number;
	viewportWidth: number;
	dx: number;
	dy: number;
	cardWidth: number;
}

/** True when a touch began in the margin the Android back gesture owns. */
export function isEdgeStart(startX: number, viewportWidth: number): boolean {
	return startX < EDGE_DEAD_ZONE || startX > viewportWidth - EDGE_DEAD_ZONE;
}

/** The one axis rule, shared by the card and by pull-to-refresh. */
export function decideAxis(dx: number, dy: number): SwipeAxis {
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	if (Math.max(ax, ay) < AXIS_SLOP) return 'undecided';
	return ax > ay * AXIS_BIAS ? 'horizontal' : 'vertical';
}

/** What a released swipe commits: left past 35% archives, right past 55% deletes. */
export function armedAction(dx: number, cardWidth: number): SwipeAction {
	if (cardWidth <= 0) return 'none';
	if (dx <= -cardWidth * ARCHIVE_FRACTION) return 'archive';
	if (dx >= cardWidth * DELETE_FRACTION) return 'delete';
	return 'none';
}

/** The whole decision for one in-flight drag over a card. */
export function decideSwipe(input: SwipeInput): { axis: SwipeAxis; action: SwipeAction } {
	if (isEdgeStart(input.startX, input.viewportWidth)) return { axis: 'blocked', action: 'none' };
	const axis = decideAxis(input.dx, input.dy);
	return { axis, action: axis === 'horizontal' ? armedAction(input.dx, input.cardWidth) : 'none' };
}
