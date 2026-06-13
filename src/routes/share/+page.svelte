<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { settings } from '$lib/settings.svelte';

	let status = $state('Clipping...');
	let errorMsg = $state('');
	let success = $state(false);
	let loading = $state(true);
	let sharedUrl = $state('');

	let tokenInputVal = $state('');
	let needsToken = $state(false);

	async function clipUrl(url: string) {
		loading = true;
		errorMsg = '';
		success = false;
		status = 'Clipping...';

		try {
			const res = await settings.authFetch('/api/queue', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url }),
			});

			if (!res.ok) {
				if (res.status === 401) {
					needsToken = true;
					loading = false;
					return;
				}
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'Failed to queue article');
			}

			// Success
			status = 'Saved!';
			success = true;
			loading = false;

			// Try to close the tab automatically after 1.5s
			setTimeout(() => {
				try {
					window.close();
				} catch (e) {
					// Browser security might block window.close()
				}
			}, 1500);

		} catch (err: any) {
			status = 'Failed to clip';
			success = false;
			loading = false;
			errorMsg = err.message || 'An unknown error occurred';
		}
	}

	function handleSaveToken() {
		if (tokenInputVal.trim()) {
			settings.saveToken(tokenInputVal.trim());
			needsToken = false;
			clipUrl(sharedUrl);
		}
	}

	onMount(() => {
		document.title = 'Clipping | Parse';
		
		const params = $page.url.searchParams;
		sharedUrl = params.get('url') || params.get('text') || '';

		// Android shares often carry titles and descriptions alongside the URL
		const urlMatch = sharedUrl.match(/https?:\/\/[^\s]+/);
		if (urlMatch) {
			sharedUrl = urlMatch[0];
		}

		if (!sharedUrl) {
			status = 'No URL shared';
			loading = false;
			errorMsg = 'Please share a valid link to parse.';
			return;
		}

		if (!settings.token) {
			needsToken = true;
			loading = false;
		} else {
			clipUrl(sharedUrl);
		}
	});
</script>

<main id="view-clipping" class="view active">
	<div class="clipping-container">
		{#if needsToken}
			<h2>Authentication Required</h2>
			<p class="settings-help" style="margin-bottom: 1.5rem;">Enter your <code>PARSE_TOKEN</code> to save this article to your library.</p>
			
			<div class="settings-group" style="width: 100%; max-width: 320px; text-align: left; display: flex; flex-direction: column;">
				<input type="password" bind:value={tokenInputVal} placeholder="Paste token here..." autocomplete="off" style="width: 100%; padding: 0.8rem; margin-bottom: 1rem; border-radius: 8px; border: 1px solid var(--border-glass); background: var(--bg-secondary); color: var(--text-primary);">
				<button class="token-save-btn" onclick={handleSaveToken} style="width: 100%; padding: 0.8rem; border-radius: 8px;">Save and Parse</button>
			</div>
		{:else}
			{#if loading}
				<div id="clipping-spinner" class="spinner large"></div>
			{/if}
			
			{#if success}
				<div id="clipping-icon" class="clipping-icon">✓</div>
			{/if}

			<h2 id="clipping-status">{status}</h2>
			
			{#if errorMsg}
				<div id="clipping-error" class="error-msg">{errorMsg}</div>
			{/if}

			{#if !loading}
				<div class="clipping-actions" id="clipping-actions">
					{#if !success}
						<button id="btn-clip-retry" class="btn" onclick={() => clipUrl(sharedUrl)}>Retry</button>
					{/if}
					<button id="btn-clip-library" class="btn" onclick={() => goto('/')}>Go to Library</button>
				</div>
			{/if}
		{/if}
	</div>
</main>

<style>
	.btn {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: 8px;
		padding: 0.8rem 1.5rem;
		font-family: var(--font-ui);
		font-weight: 600;
		cursor: pointer;
		transition: var(--transition);
	}
	.btn:hover {
		background: var(--accent-hover);
	}
</style>
