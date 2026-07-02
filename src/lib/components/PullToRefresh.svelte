<script lang="ts">
	import { type Snippet } from 'svelte';

	let { onRefresh, children }: { onRefresh: () => Promise<void>, children: Snippet } = $props();

	let startY = 0;
	let currentY = 0;
	let isPulling = $state(false);
	let refreshing = $state(false);
	let pullDistance = $state(0);
	let containerRef: HTMLElement | null = $state(null);
	
	const THRESHOLD = 70; // pixels to pull before triggering
	const MAX_PULL = 120;
	
	function handleTouchStart(e: TouchEvent) {
		if (refreshing) return;
		// Only allow pull-to-refresh if we are at the very top of the page
		if (window.scrollY > 5) return;
		
		startY = e.touches[0].clientY;
		isPulling = true;
		pullDistance = 0;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isPulling || refreshing) return;
		
		currentY = e.touches[0].clientY;
		const deltaY = currentY - startY;
		
		if (deltaY > 0 && window.scrollY <= 0) {
			// Pulling down while at the top
			pullDistance = Math.min(deltaY * 0.4, MAX_PULL); // add resistance
			
			// We can't always prevent default on passive listeners, 
			// but we can let the visual transform handle the feedback.
		} else {
			// Scrolling up or moved away from top, abort pull
			isPulling = false;
			pullDistance = 0;
		}
	}

	async function handleTouchEnd() {
		if (!isPulling) return;
		isPulling = false;
		
		if (pullDistance > THRESHOLD) {
			refreshing = true;
			pullDistance = THRESHOLD; // Snap back to threshold height while loading
			
			const startTime = Date.now();
			try {
				await onRefresh();
			} catch (err) {
				console.error('Refresh failed', err);
			} finally {
				const elapsed = Date.now() - startTime;
				const remainingTime = Math.max(0, 500 - elapsed);
				
				setTimeout(() => {
					refreshing = false;
					pullDistance = 0;
				}, remainingTime);
			}
		} else {
			pullDistance = 0;
		}
	}
</script>

<div 
	bind:this={containerRef}
	class="ptr-container"
	role="group"
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
>
	<div 
		class="ptr-indicator"
		style="transform: translateY({pullDistance > 0 || refreshing ? pullDistance : 0}px); opacity: {pullDistance / THRESHOLD};"
		class:refreshing
	>
		<div class="spinner ptr-spinner" style="transform: rotate({pullDistance * 3}deg);"></div>
	</div>

	<div 
		class="ptr-content"
		style="transform: translateY({pullDistance}px); transition: {isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'};"
	>
		{@render children()}
	</div>
</div>

<style>
	.ptr-container {
		position: relative;
		width: 100%;
		min-height: 100%;
	}

	.ptr-indicator {
		position: absolute;
		top: -40px; /* Hidden above the container */
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 10;
		pointer-events: none;
		transition: opacity 0.2s, transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.ptr-indicator.refreshing {
		transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.ptr-spinner {
		width: 28px;
		height: 28px;
		border-width: 2.5px;
		border-color: var(--accent) transparent var(--accent) transparent;
		background-color: var(--bg-surface);
		border-radius: 50%;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}

	.ptr-indicator:not(.refreshing) .ptr-spinner {
		/* Disable infinite animation while just pulling */
		animation: none;
	}

	.ptr-content {
		position: relative;
		z-index: 1;
		width: 100%;
		height: 100%;
	}
</style>
