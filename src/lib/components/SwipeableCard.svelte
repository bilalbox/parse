<script lang="ts">
	import { type Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import { armedAction, decideAxis, isEdgeStart, type SwipeAxis } from '$lib/swipe';

	let {
		enabled = true,
		archiveIcon = 'archive',
		archiveLabel = 'Archive',
		onArchive,
		onDelete,
		children
	}: {
		enabled?: boolean;
		archiveIcon?: IconName;
		archiveLabel?: string;
		onArchive: () => void;
		onDelete: () => void;
		children: Snippet;
	} = $props();

	let row: HTMLElement;
	let startX = 0;
	let startY = 0;
	let axis: SwipeAxis = 'undecided';
	/** Set the moment the drag becomes a swipe, so the tap it ends with never opens the Article. */
	let swallowClick = false;

	let offset = $state(0);
	let cardWidth = $state(0);
	let settling = $state(false);

	const armed = $derived(armedAction(offset, cardWidth));

	function handleTouchStart(e: TouchEvent): void {
		swallowClick = false;
		settling = false;
		if (!enabled || e.touches.length !== 1) {
			axis = 'blocked';
			return;
		}
		const touch = e.touches[0];
		if (isEdgeStart(touch.clientX, window.innerWidth)) {
			axis = 'blocked';
			return;
		}
		axis = 'undecided';
		startX = touch.clientX;
		startY = touch.clientY;
		cardWidth = row.getBoundingClientRect().width;
	}

	function handleTouchMove(e: TouchEvent): void {
		if (axis === 'blocked' || axis === 'vertical') return;
		const touch = e.touches[0];
		const dx = touch.clientX - startX;
		const dy = touch.clientY - startY;

		if (axis === 'undecided') {
			axis = decideAxis(dx, dy);
			// Vertical belongs to the scroller and to pull-to-refresh; stay out of it
			// for the rest of this drag rather than re-testing on every frame.
			if (axis !== 'horizontal') return;
			swallowClick = true;
		}
		offset = dx;
	}

	function handleTouchEnd(): void {
		const action = axis === 'horizontal' ? armedAction(offset, cardWidth) : 'none';
		axis = 'undecided';
		settling = true;
		offset = 0;
		if (action === 'none') return;

		// Delete can reach a blocking `confirm()`, which freezes the frame before the
		// card has painted its way back — leaving a native dialog stacked on a card
		// still stuck at full swipe. Two frames puts the settle on screen first.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (action === 'archive') onArchive();
				else onDelete();
			})
		);
	}

	function handleTouchCancel(): void {
		axis = 'blocked';
		settling = true;
		offset = 0;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={row}
	class="swipe-row"
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
	ontouchcancel={handleTouchCancel}
	onclickcapture={(e) => {
		if (!swallowClick) return;
		swallowClick = false;
		e.preventDefault();
		e.stopPropagation();
	}}
>
	{#if offset !== 0}
		<div class="swipe-track" class:armed-archive={armed === 'archive'} class:armed-delete={armed === 'delete'} aria-hidden="true">
			<span class="swipe-hint hint-delete" class:shown={offset > 0}>
				<Icon name="trash" />
				<span>Delete</span>
			</span>
			<span class="swipe-hint hint-archive" class:shown={offset < 0}>
				<span>{archiveLabel}</span>
				<Icon name={archiveIcon} />
			</span>
		</div>
	{/if}

	<div
		class="swipe-surface"
		style="transform: translateX({offset}px); transition: {settling ? 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'};"
	>
		{@render children()}
	</div>
</div>

<style>
	.swipe-row {
		position: relative;
		border-radius: 12px; /* matches .article-card, so the track never peeks past a corner */
		overflow: hidden;
		/* Hands vertical panning to the browser and keeps horizontal for us, with no
		   non-passive listener and no preventDefault fight over the scroll. */
		touch-action: pan-y;
	}

	.swipe-track {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 1.25rem;
		background: var(--bg-secondary);
		color: var(--text-secondary);
		font-family: var(--font-ui);
		font-size: 0.85rem;
		transition: background-color 0.15s, color 0.15s;
	}

	/* Colour only once the action would actually fire on release — the track is a
	   readout of what happens next, not decoration. */
	.swipe-track.armed-archive {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.swipe-track.armed-delete {
		background: var(--error);
		color: #fff;
	}

	.swipe-hint {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.swipe-hint.shown {
		opacity: 1;
	}

	.swipe-surface {
		position: relative;
		z-index: 1;
	}
</style>
