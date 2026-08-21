<script lang="ts">
	import { registerBackOverlay } from '$lib/android-back';
	import { openExternal } from '$lib/open-external';

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
			<button class="icon-btn" onclick={onClose}>×</button>
		</div>
		<div class="link-url-preview" style="margin-bottom: 1rem; color: var(--text-secondary); word-break: break-all; font-size: 0.9rem;">
			{url}
		</div>
		<div class="sheet-actions" style="display: flex; flex-direction: column; gap: 0.5rem;">
			<button 
				class="card-btn" 
				style="padding: 1rem; font-size: 1rem; text-align: left; border: 1px solid var(--border-glass);"
				onclick={() => onSave(url)}>
				➕ Save to Parse
			</button>
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				class="card-btn"
				style="padding: 1rem; font-size: 1rem; text-align: left; text-decoration: none; display: block; border: 1px solid var(--border-glass);"
				onclick={(e) => {
					e.preventDefault();
					void openExternal(url);
					onClose();
				}}>
				🌐 Open in Browser
			</a>
		</div>
	</div>
</div>
