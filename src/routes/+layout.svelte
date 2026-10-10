<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { settings } from '$lib/settings.svelte';
	import { tts } from '$lib/tts.svelte';
	import { toast } from '$lib/toast.svelte';
	import { EXIT_CONFIRM_MS, createAndroidBackHandler } from '$lib/android-back';
	import { openExternal } from '$lib/open-external';
	import Icon from '$lib/components/Icon.svelte';
	import { fly, fade } from 'svelte/transition';

	// Svelte 5 layout uses the children prop
	let { children } = $props();

	const PLAYBACK_SPEEDS = [0.75, 1.0, 1.2, 1.5, 2.0];
	function cyclePlaybackSpeed(): void {
		const curr = tts.selectedSpeed;
		const idx = PLAYBACK_SPEEDS.findIndex((s) => Math.abs(s - curr) < 0.05);
		const next = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
		tts.setSpeed(next);
	}

	onMount(() => {
		let cancelled = false;
		let removeListener: (() => void) | undefined;

		void import('@capacitor/core').then(async ({ Capacitor }) => {
			if (cancelled || !Capacitor.isNativePlatform()) return;
			const { App } = await import('@capacitor/app');
			const handleBack = createAndroidBackHandler({
				goHome: () => goto('/', { replaceState: true }),
				confirmExit: () => toast.show('Press back again to exit', 'info', EXIT_CONFIRM_MS),
				exitApp: () => App.exitApp()
			});
			const listener = await App.addListener('backButton', () => {
				handleBack(page.url.pathname);
			});
			if (cancelled) {
				void listener.remove();
				return;
			}
			removeListener = () => { void listener.remove(); };
		});

		return () => {
			cancelled = true;
			removeListener?.();
		};
	});
</script>

<div id="layout-root" style="width: 100%; height: 100%; position: relative;">
	{#key page.url.pathname}
		<div
			in:fly={{ x: 200, duration: 250, delay: 150 }}
			out:fly={{ x: -100, duration: 150 }}
			style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;"
			onoutrostart={(e) => { e.currentTarget.style.pointerEvents = 'none'; }}
		>
			{@render children()}
		</div>
	{/key}

	<!-- Floating narration player -->
	{#if tts.visible}
		<div id="tts-player" class="tts-player-panel active" transition:fly={{ y: 100, duration: 300 }}>
			<div 
				class="player-progress-container" 
				id="player-progress-area"
				onclick={(e) => {
					// The scrubber knows how far along it was clicked; the player owns
					// what that means for the queue.
					const rect = e.currentTarget.getBoundingClientRect();
					tts.seekToFraction((e.clientX - rect.left) / rect.width);
				}}
				onkeydown={() => {}}
				role="slider"
				aria-label="Narration progress"
				aria-valuenow={Math.round(tts.progress * 100)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuetext="{Math.round(tts.progress * 100)}% through the article"
				tabindex="0"
			>
				<div 
					class="player-progress-bar" 
					id="player-progress" 
					style="width: {tts.progress * 100}%"
				></div>
			</div>

			<div class="player-content">
				<div class="player-info">
					<div class="player-artwork" id="player-art">
						{#if tts.featuredImage}
							<img src={tts.featuredImage} alt="Cover Art" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;" />
						{:else}
							<span class="player-art-icon">{tts.articleTitle?.[0]?.toUpperCase() ?? '\u2014'}</span>
						{/if}
					</div>
					<div class="player-metadata">
						<div class="player-title" id="player-title">{tts.articleTitle}</div>
						<div class="player-author" id="player-author">
							{tts.articleAuthor ? `By ${tts.articleAuthor}` : 'Unknown Author'}
						</div>
					</div>
				</div>

				<!-- Three controls, not five: the old ⏪/⏩ pair called the same
				     prevSentence/nextSentence handlers as ⏮/⏭ while claiming to skip
				     15s. Sentence steps are the better unit for prose anyway — they
				     land on a boundary instead of mid-word. -->
				<div class="player-controls-group">
					<button class="player-icon-btn" onclick={() => tts.prevSentence()} title="Previous sentence">
						<Icon name="skip-back" />
					</button>
					<button
						class="player-icon-btn player-play-btn"
						onclick={() => tts.togglePlay()}
						title={tts.isPlaying ? 'Pause' : 'Play'}
					>
						<Icon name={tts.isPlaying ? 'pause' : 'play'} size={22} />
					</button>
					<button class="player-icon-btn" onclick={() => tts.nextSentence()} title="Next sentence">
						<Icon name="skip-forward" />
					</button>
				</div>

				<div class="player-extra">
					<button
						type="button"
						class="player-speed-btn"
						onclick={cyclePlaybackSpeed}
						title="Playback speed (tap to cycle: {tts.selectedSpeed}x)"
					>
						{tts.selectedSpeed}x
					</button>
					<div class="select-wrapper">
						<select 
							value={tts.selectedVoice}
							onchange={(e) => tts.setVoice(e.currentTarget.value)} 
							class="player-select" 
							title="Voice Selection"
							disabled={!tts.hasVoice}
						>
							{#if !tts.hasVoice}
								<option value="">No voice installed</option>
							{:else}
								{#each tts.getUsableVoices() as voice (voice.name)}
									<option value={voice.name}>{voice.name} ({voice.lang})</option>
								{/each}
							{/if}
						</select>
					</div>
					<button class="player-close-btn" onclick={() => tts.hidePlayer()} title="Close player">
						<Icon name="close" size={18} />
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Global Toast Notifications -->
	{#if toast.visible}
		<div class="toast-container" style="position: fixed; bottom: 84px; right: 24px; z-index: 9999;" transition:fade={{ duration: 150 }}>
			<div class="toast {toast.type === 'error' ? 'toast-error' : ''}" style="margin: 0;">
				{#if toast.href}
					<span style="margin-right: 0.5rem;">{toast.message}</span>
					<a
						href={toast.href}
						class="toast-link"
						target="_blank"
						rel="noopener noreferrer"
						onclick={(e) => {
							e.preventDefault();
							void openExternal(toast.href);
						}}>{toast.linkText}</a
					>
					<button class="toast-dismiss" onclick={() => toast.dismiss()} title="Dismiss">
						<Icon name="close" size={16} />
					</button>
				{:else}
					{toast.message}
				{/if}
			</div>
		</div>
	{/if}
</div>
