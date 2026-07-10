<script lang="ts">
	import { settings } from '$lib/settings.svelte';
	import { toast } from '$lib/toast.svelte';
	import { goto } from '$app/navigation';

	let code = $state('');
	let loading = $state(true);
	let submitting = $state(false);

	$effect(() => {
		settings.loadUser()
			.then(() => {
				loading = false;
			})
			.catch(() => {
				toast.show('Please login first to link a device', 'error');
				goto('/login');
			});
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!code || code.length !== 6) {
			toast.show('Code must be 6 characters', 'error');
			return;
		}
		
		submitting = true;
		try {
			const res = await settings.authFetch(`/api/auth/device/${code.toUpperCase()}/link`, {
				method: 'POST'
			});
			if (res.ok) {
				toast.show('Device linked successfully');
				goto('/');
			} else {
				const data = (await res.json()) as { error?: string };
				toast.show(data.error || 'Failed to link device', 'error');
			}
		} catch (e) {
			toast.show('Failed to link device', 'error');
		} finally {
			submitting = false;
		}
	}
	
	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		code = target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	}
</script>

<svelte:head>
	<title>Link Device - Parse</title>
</svelte:head>

<main class="link-view">
	<div class="link-box">
		<h1 class="title">Link a Device</h1>
		<p class="subtitle">Enter the 6-character code shown on your E-Reader.</p>
		
		{#if loading}
			<div class="loading">Loading...</div>
		{:else}
			<form onsubmit={submit}>
				<input
					type="text"
					class="code-input"
					placeholder="ABCDEF"
					value={code}
					oninput={handleInput}
					disabled={submitting}
					maxlength="6"
					autocomplete="off"
					spellcheck="false"
					autofocus
				/>
				
				<button type="submit" class="submit-btn" disabled={submitting || code.length !== 6}>
					{submitting ? 'Linking...' : 'Link Device'}
				</button>
			</form>
		{/if}
	</div>
</main>

<style>
	.link-view {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--bg-primary);
		font-family: var(--font-ui);
	}
	.link-box {
		background: var(--bg-secondary);
		padding: 3rem 2rem;
		border-radius: 16px;
		border: 1px solid var(--border-glass);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
		text-align: center;
		width: 100%;
		max-width: 360px;
	}
	.title {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
	}
	.subtitle {
		color: var(--text-secondary);
		margin-bottom: 2rem;
		line-height: 1.5;
	}
	.code-input {
		width: 100%;
		font-family: monospace;
		font-size: 2.5rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-align: center;
		color: var(--text-primary);
		background: var(--bg-primary);
		padding: 1rem;
		border-radius: 12px;
		border: 1px solid var(--border-glass);
		margin-bottom: 1.5rem;
		text-transform: uppercase;
	}
	.code-input:focus {
		outline: none;
		border-color: var(--text-primary);
	}
	.submit-btn {
		width: 100%;
		padding: 1rem;
		background: var(--text-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.submit-btn:hover:not(:disabled) {
		opacity: 0.9;
	}
	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.loading {
		color: var(--text-secondary);
		padding: 2rem 0;
	}
</style>
