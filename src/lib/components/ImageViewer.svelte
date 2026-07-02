<script lang="ts">
	import { fade } from 'svelte/transition';

	let { src, show, onClose } = $props<{
		src: string;
		show: boolean;
		onClose: () => void;
	}>();
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div 
		class="image-viewer-overlay" 
		transition:fade={{ duration: 200 }} 
		onclick={onClose} 
		role="dialog" 
		aria-modal="true"
		tabindex="-1"
	>
		<img {src} alt="Fullscreen View" class="fullscreen-image" />
	</div>
{/if}

<style>
	.image-viewer-overlay {
		position: fixed;
		inset: 0;
		z-index: 3000;
		background: rgba(0, 0, 0, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		cursor: zoom-out;
	}
	
	.fullscreen-image {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		border-radius: 4px;
	}
</style>
