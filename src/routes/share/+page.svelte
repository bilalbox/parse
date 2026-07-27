<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { settings } from '$lib/settings.svelte';
	import { toast } from '$lib/toast.svelte';

	let status = $state('Clipping...');
	let errorMsg = $state('');
	let success = $state(false);
	let loading = $state(true);
	let sharedUrl = $state('');


	async function clipUrl(url: string): Promise<void> {
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
					await settings.clearNativeSession();
					goto('/login');
					return;
				}
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to queue article');
			}

			status = 'Saved!';
			success = true;
			loading = false;
			toast.show('Link saved ✓');
		} catch (err: any) {
			status = 'Failed to clip';
			success = false;
			loading = false;
			errorMsg = err.message || 'An unknown error occurred';
		}
	}


	onMount(() => {
		document.title = 'Clipping | Parse';
		
		const params = page.url.searchParams;
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

		clipUrl(sharedUrl);
	});
</script>

<main id="view-clipping" class="view active">
	<div class="clipping-container">

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
