<script lang="ts">
	import { registerBackOverlay } from '$lib/android-back';
	import { openExternal } from '$lib/open-external';
	import Icon from './Icon.svelte';

	let {
		url = '',
		show = false,
		onClose,
		onSave
	} = $props<{
		url: string;
		show: boolean;
		onClose: () => void;
		onSave: (url: string) => void;
	}>();

	$effect(() => {
		if (!show) return;
		return registerBackOverlay(() => {
			onClose();
			return true;
		});
	});
</script>

<div class="bottom-sheet {show ? 'active' : ''}">
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={onClose}></div>
	<div class="sheet-content">
		<div class="sheet-header">
			<h3>Link Options</h3>
			<button class="icon-btn" onclick={onClose} title="Close"><Icon name="close" /></button>
		</div>
		<p class="sheet-subject" style="word-break: break-all;">{url}</p>
		<div class="sheet-actions">
			<button class="sheet-action" onclick={() => onSave(url)}>
				<Icon name="plus" />
				<span>Save to Parse</span>
			</button>
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				class="sheet-action"
				onclick={(e) => {
					e.preventDefault();
					void openExternal(url);
					onClose();
				}}
			>
				<Icon name="external" />
				<span>Open in Browser</span>
			</a>
		</div>
	</div>
</div>
