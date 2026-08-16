<script lang="ts">
	import { toast } from '$lib/toast.svelte';
	import { page } from '$app/state';
	import { registerBackOverlay } from '$lib/android-back';

	let isNative = $state(false);
	let loginMode = $state<'google' | 'device'>('google');
	let deviceCode = $state<string | null>(null);
	let pollingTimeout = $state<number | null>(null);

	if (typeof window !== 'undefined') {
		import('@capacitor/core').then(({ Capacitor }) => {
			isNative = Capacitor.isNativePlatform();
		});
	}

	async function startDeviceLogin() {
		loginMode = 'device';
		try {
			const res = await fetch('/api/auth/device', { method: 'POST' });
			const data = (await res.json()) as { code: string };
			deviceCode = data.code;
			pollDeviceLogin();
		} catch (e) {
			console.error(e);
			loginMode = 'google';
			toast.show('Failed to generate code', 'error');
		}
	}

	function stopDeviceLogin() {
		loginMode = 'google';
		deviceCode = null;
		if (pollingTimeout) {
			clearTimeout(pollingTimeout);
			pollingTimeout = null;
		}
	}

	$effect(() => {
		if (loginMode !== 'device') return;
		return registerBackOverlay(() => {
			stopDeviceLogin();
			return true;
		});
	});

	async function pollDeviceLogin() {
		if (!deviceCode || loginMode !== 'device') return;
		try {
			const res = await fetch(`/api/auth/device/${deviceCode}/poll`, { method: 'POST' });
			if (res.status === 200) {
				const data = (await res.json().catch(() => ({}))) as { session?: string };
				if (data.session) {
					const { settings } = await import('$lib/settings.svelte');
					await settings.setNativeSession(data.session);
				}
				window.location.href = '/';
				return;
			}
			if (res.status === 400) {
				toast.show('Code expired', 'error');
				stopDeviceLogin();
				return;
			}
			pollingTimeout = window.setTimeout(pollDeviceLogin, 3000);
		} catch (e) {
			console.error(e);
			pollingTimeout = window.setTimeout(pollDeviceLogin, 3000);
		}
	}

	// Google blocks OAuth inside the app's WebView, so native opens the flow in the
	// system browser; the callback hands the session back via a deep link (see settings.svelte.ts).
	async function loginNative(e: SubmitEvent) {
		e.preventDefault();
		const { Browser } = await import('@capacitor/browser');
		await Browser.open({ url: 'https://parse.23p.dev/auth/google?native=1' });
	}
</script>

<svelte:head>
	{#if !isNative}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<main class="login-view">
	<div class="login-box">
		<h1 class="logo">PARSE</h1>
		<p class="subtitle">Edge reading, simplified.</p>
		
		{#if page.url.searchParams.get('error') === 'invite_required'}
			<p class="error-notice">An invite is required to create a new account.</p>
		{/if}
		{#if page.url.searchParams.get('error') === 'turnstile_failed'}
			<p class="error-notice">Security check failed. Please try again.</p>
		{/if}
		
		{#if loginMode === 'google'}
			<form action="/auth/google" method="GET" onsubmit={isNative ? loginNative : undefined}>
				{#if !isNative}
					<!-- Turnstile testing sitekey -->
					<div class="cf-turnstile turnstile-container" data-sitekey="0x4AAAAAADo-EeRA3ZndjkWH"></div>
				{/if}
				
				<button type="submit" class="google-btn">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
						<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
						<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
						<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
					</svg>
					Login with Google
				</button>
				
				<div class="divider">or</div>
				
				<button type="button" class="ereader-btn" onclick={startDeviceLogin}>
					Login on E-Reader
				</button>
			</form>
		{:else}
			<div class="device-login">
				<p>Go to <strong>parse.23p.dev/link</strong> on your phone and enter this code:</p>
				<div class="device-code">{deviceCode || '...'}</div>
				<button type="button" class="back-btn" onclick={stopDeviceLogin}>Back</button>
			</div>
		{/if}
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
	.divider {
		margin: 1.5rem 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
		position: relative;
	}
	.divider::before, .divider::after {
		content: "";
		position: absolute;
		top: 50%;
		width: 40%;
		height: 1px;
		background: var(--border-glass);
	}
	.divider::before { left: 0; }
	.divider::after { right: 0; }

	.ereader-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0.85rem;
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border-glass);
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}
	.ereader-btn:hover {
		background: var(--border-glass);
	}

	.device-login p {
		color: var(--text-secondary);
		line-height: 1.5;
		margin-bottom: 1.5rem;
	}
	.device-code {
		font-family: monospace;
		font-size: 2.5rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--text-primary);
		background: var(--bg-primary);
		padding: 1rem;
		border-radius: 12px;
		border: 1px solid var(--border-glass);
		margin-bottom: 2rem;
	}
	.back-btn {
		width: 100%;
		padding: 0.85rem;
		background: transparent;
		color: var(--text-secondary);
		border: none;
		font-weight: 600;
		cursor: pointer;
	}
	.back-btn:hover {
		color: var(--text-primary);
	}
</style>
