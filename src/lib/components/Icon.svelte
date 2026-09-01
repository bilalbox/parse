<script lang="ts" module>
	/**
	 * The app's single icon vocabulary. Outline strokes on `currentColor` at a
	 * uniform 24-unit grid, so every icon inherits the button's colour and
	 * survives e-ink mode (pure black on white) with no extra rules.
	 *
	 * Replaces the three vocabularies that used to be mixed across the UI —
	 * colour emoji (which rendered as tofu or as blue tiles in the Android
	 * WebView), Unicode symbols, and text glyphs. `Aa` stays a typographic
	 * glyph in the toolbar rather than becoming an icon: a letterform is the
	 * clearest possible signifier for "typography".
	 */
	export type IconName =
		| 'arrow-left'
		| 'play'
		| 'pause'
		| 'sparkle'
		| 'more'
		| 'chevron-left'
		| 'chevron-right'
		| 'unsubscribe'
		| 'archive'
		| 'unarchive'
		| 'trash'
		| 'plus'
		| 'settings'
		| 'contrast'
		| 'close'
		| 'skip-back'
		| 'skip-forward'
		| 'external';

	const PATHS: Record<IconName, string> = {
		'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
		play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
		pause: '<path d="M9 4.5v15"/><path d="M15 4.5v15"/>',
		sparkle:
			'<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z"/><path d="M18.5 4v3"/><path d="M20 5.5h-3"/>',
		more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
		'chevron-left': '<path d="m14.5 5-7 7 7 7"/>',
		'chevron-right': '<path d="m9.5 5 7 7-7 7"/>',
		unsubscribe: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
		archive:
			'<path d="M3.5 7.5h17v3h-17z"/><path d="M5 10.5v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M10 14h4"/>',
		unarchive:
			'<path d="M3.5 7.5h17v3h-17z"/><path d="M5 10.5v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M12 17v-4.5"/><path d="m9.75 14.75 2.25-2.25 2.25 2.25"/>',
		trash:
			'<path d="M4.5 6.5h15"/><path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M6.5 6.5v12a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-12"/><path d="M10.5 10v6"/><path d="M13.5 10v6"/>',
		plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
		settings:
			'<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
		contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none"/>',
		close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
		'skip-back': '<path d="M18 5.5v13L8.5 12 18 5.5Z"/><path d="M6 5.5v13"/>',
		'skip-forward': '<path d="M6 5.5v13L15.5 12 6 5.5Z"/><path d="M18 5.5v13"/>',
		external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14.5v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h4"/>'
	};

	/** Icons whose shape reads as a solid mark rather than an outline. */
	const FILLED = new Set<IconName>(['play', 'skip-back', 'skip-forward']);
</script>

<script lang="ts">
	let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
	class="icon"
	class:icon-filled={FILLED.has(name)}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false">{@html PATHS[name]}</svg
>

<style>
	.icon {
		display: block;
		flex: none;
	}

	/* Solid marks read at the same visual weight as the outline set only when
	   filled; stroking them too would thicken them past everything else. */
	.icon-filled :global(path) {
		fill: currentColor;
	}
</style>
