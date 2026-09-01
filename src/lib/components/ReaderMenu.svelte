<script lang="ts">
	import { registerBackOverlay } from '$lib/android-back';
	import Icon from './Icon.svelte';

	/**
	 * Overflow actions for the reader. These live behind a deliberate tap
	 * rather than inline in the toolbar: they are one-shot or destructive,
	 * not things you reach for mid-read.
	 */
	let {
		show = false,
		archived = false,
		canUnsubscribe = false,
		online = true,
		onClose,
		onUnsubscribe,
		onArchive,
		onDelete
	}: {
		show: boolean;
		archived: boolean;
		canUnsubscribe: boolean;
		online: boolean;
		onClose: () => void;
		onUnsubscribe: () => void;
		onArchive: () => void;
		onDelete: () => void;
	} = $props();

	$effect(() => {
		if (!show) return;
		return registerBackOverlay(() => {
			onClose();
			return true;
		});
	});

	function run(action: () => void): void {
		onClose();
		action();
	}
</script>

<div class="bottom-sheet {show ? 'active' : ''}">
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={onClose}></div>
	<div class="sheet-content">
		<div class="sheet-header">
			<h3>Article</h3>
			<button class="icon-btn" onclick={onClose} title="Close"><Icon name="close" /></button>
		</div>
		<div class="sheet-actions">
			{#if canUnsubscribe}
				<button class="sheet-action" disabled={!online} onclick={() => run(onUnsubscribe)}>
					<Icon name="unsubscribe" />
					<span>Unsubscribe</span>
				</button>
			{/if}
			<button class="sheet-action" disabled={!online} onclick={() => run(onArchive)}>
				<Icon name={archived ? 'unarchive' : 'archive'} />
				<span>{archived ? 'Restore to library' : 'Archive'}</span>
			</button>
			<button class="sheet-action sheet-action-danger" disabled={!online} onclick={() => run(onDelete)}>
				<Icon name="trash" />
				<span>Delete</span>
			</button>
		</div>
	</div>
</div>
