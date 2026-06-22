<script lang="ts">
	import { settings } from '$lib/settings.svelte';
	import { page } from '$app/stores';
</script>

<svelte:head>
	<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</svelte:head>

<main class="login-view">
	<div class="login-box">
		<h1 class="logo">PARSE</h1>
		<p class="subtitle">Edge reading, simplified.</p>
		
		{#if $page.url.searchParams.get('error') === 'invite_required'}
			<p class="error-notice">An invite is required to create a new account.</p>
		{/if}
		{#if $page.url.searchParams.get('error') === 'turnstile_failed'}
			<p class="error-notice">Security check failed. Please try again.</p>
		{/if}
		
		<form action="/auth/google" method="GET">
			<!-- Turnstile testing sitekey -->
			<div class="cf-turnstile turnstile-container" data-sitekey="0x4AAAAAADo-EeRA3ZndjkWH"></div>
			
			<button type="submit" class="google-btn">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
					<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
					<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
					<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
				</svg>
				Login with Google
			</button>
		</form>
	</div>
</main>

<style>
	.login-view {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--bg-primary);
		font-family: var(--font-ui);
	}
	.login-box {
		background: var(--bg-secondary);
		padding: 3rem 2rem;
		border-radius: 16px;
		border: 1px solid var(--border-glass);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
		text-align: center;
		width: 100%;
		max-width: 360px;
	}
	.logo {
		font-size: 2.5rem;
		font-weight: 800;
		letter-spacing: -0.05em;
		margin: 0;
		color: var(--text-primary);
	}
	.subtitle {
		color: var(--text-secondary);
		margin-bottom: 2rem;
	}

	.error-notice {
		background: rgba(255, 60, 60, 0.1);
		color: #ff4444;
		padding: 0.75rem;
		border-radius: 8px;
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
		font-weight: 500;
	}

	.turnstile-container {
		margin-bottom: 1rem;
		display: flex;
		justify-content: center;
	}

	.google-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.85rem;
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border-glass);
		border-radius: 8px;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.2s;
	}
	.google-btn:hover {
		background: var(--border-glass);
	}
</style>
