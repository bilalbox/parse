<script lang="ts">
	import { registerBackOverlay } from '$lib/android-back';
	import { settings } from '$lib/settings.svelte';

	/**
	 * Typography controls, anchored under the toolbar rather than presented as
	 * a sheet: you need to watch the article reflow as you adjust, which a
	 * sheet covering the lower half of the screen would defeat.
	 *
	 * Replaces three blind toolbar buttons (A- / A+ / T). The typefaces are
	 * named here; the old `T` cycled four families of which two had no CSS at
	 * all, so two taps in four did nothing.
	 */
	let { show = false, onClose }: { show: boolean; onClose: () => void } = $props();

	const FAMILIES = [
		{ id: 'sans', label: 'Sans', hint: 'Plus Jakarta Sans' },
		{ id: 'serif', label: 'Serif', hint: 'Lora' },
		{ id: 'amiri', label: 'Amiri', hint: 'Arabic serif' },
		{ id: 'cairo', label: 'Cairo', hint: 'Arabic sans' }
	];

	const MIN_SIZE = 0.8;
	const MAX_SIZE = 2.5;
	const STEP = 0.05;

	const sizePercent = $derived(Math.round((settings.fontSize / 1.15) * 100));

	$effect(() => {
		if (!show) return;
		return registerBackOverlay(() => {
			onClose();
			return true;
		});
	});
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="popover-backdrop" onclick={onClose}></div>
	<div class="type-panel" role="dialog" aria-label="Typography">
		<div class="type-row">
			<span class="type-row-label">Size</span>
			<div class="stepper">
				<button
					class="stepper-btn"
					disabled={settings.fontSize <= MIN_SIZE}
					onclick={() => settings.setFontSize(settings.fontSize - STEP)}
					title="Decrease text size">A<span class="stepper-sign">−</span></button
				>
				<span class="stepper-value">{sizePercent}%</span>
				<button
					class="stepper-btn stepper-btn-lg"
					disabled={settings.fontSize >= MAX_SIZE}
					onclick={() => settings.setFontSize(settings.fontSize + STEP)}
					title="Increase text size">A<span class="stepper-sign">+</span></button
				>
			</div>
		</div>

		<div class="type-row type-row-stack">
			<span class="type-row-label">Typeface</span>
			<div class="family-grid">
				{#each FAMILIES as family (family.id)}
					<button
						class="family-btn"
						class:selected={settings.fontFamily === family.id}
						onclick={() => settings.setFontFamily(family.id)}
					>
						<span class="family-label typography-{family.id}">{family.label}</span>
						<span class="family-hint">{family.hint}</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}
