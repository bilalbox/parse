<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { settings } from '$lib/settings.svelte';
	import { tts } from '$lib/tts.svelte';
	import { toast } from '$lib/toast.svelte';
	import { fly, fade } from 'svelte/transition';

	// Svelte 5 layout uses the children prop
	let { children } = $props();
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

	<!-- Sleek Glassmorphic Floating TTS Player Sheet -->
	{#if tts.visible}
		<div id="tts-player" class="tts-player-panel active" transition:fly={{ y: 100, duration: 300 }}>
			<div class="player-blur-bg"></div>
			
			<div 
				class="player-progress-container" 
				id="player-progress-area"
				onclick={(e) => {
					if (tts.sentences.length === 0) return;
					const rect = e.currentTarget.getBoundingClientRect();
					const clickX = e.clientX - rect.left;
					const pct = clickX / rect.width;
					const targetIdx = Math.floor(pct * tts.sentences.length);
					tts.jumpToSentence(Math.max(0, Math.min(targetIdx, tts.sentences.length - 1)));
				}}
				onkeydown={() => {}}
				role="slider"
				aria-valuenow={tts.currentIndex}
				aria-valuemin={0}
				aria-valuemax={tts.sentences.length}
				tabindex="0"
			>
				<div 
					class="player-progress-bar" 
					id="player-progress" 
					style="width: {tts.sentences.length > 0 ? (tts.currentIndex / tts.sentences.length) * 100 : 0}%"
				></div>
			</div>

			<div class="player-content">
				<div class="player-info">
					<div class="player-artwork" id="player-art">
						{#if tts.featuredImage}
							<img src={tts.featuredImage} alt="Cover Art" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;" />
						{:else}
							<span class="player-art-icon">🎙️</span>
						{/if}
					</div>
					<div class="player-metadata">
						<div class="player-title" id="player-title">{tts.articleTitle}</div>
						<div class="player-author" id="player-author">
							{tts.articleAuthor ? `By ${tts.articleAuthor}` : 'Unknown Author'}
						</div>
					</div>
				</div>

				<div class="player-controls-group">
					<button class="player-icon-btn" onclick={() => tts.prevSentence()} title="Previous Sentence">⏮</button>
					<button class="player-icon-btn" onclick={() => tts.prevSentence()} title="Rewind 15s">⏪</button>
					<button 
						class="player-icon-btn player-play-btn" 
						onclick={() => tts.togglePlay()} 
						title={tts.isPlaying ? 'Pause' : 'Play'}
					>
						{tts.isPlaying ? '⏸' : '▶'}
					</button>
					<button class="player-icon-btn" onclick={() => tts.nextSentence()} title="Forward 15s">⏩</button>
					<button class="player-icon-btn" onclick={() => tts.nextSentence()} title="Next Sentence">⏭</button>
				</div>

				<div class="player-extra">
					<div class="select-wrapper">
						<select 
							value={tts.selectedSpeed} 
							onchange={(e) => tts.setSpeed(parseFloat(e.currentTarget.value))} 
							class="player-select" 
							title="Playback Speed"
						>
							<option value="0.5">0.5x</option>
							<option value="0.75">0.75x</option>
							<option value="1">1.0x</option>
							<option value="1.2">1.2x</option>
							<option value="1.5">1.5x</option>
							<option value="1.75">1.75x</option>
							<option value="2">2.0x</option>
						</select>
					</div>
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
									<option value={voice.name}>🗣️ {voice.name} ({voice.lang})</option>
								{/each}
							{/if}
						</select>
					</div>
					<button class="player-close-btn" onclick={() => tts.hidePlayer()} title="Close Player">×</button>
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
					<a href={toast.href} class="toast-link" target="_blank" rel="noopener noreferrer">{toast.linkText}</a>
					<button onclick={() => toast.dismiss()} style="background: transparent; border: none; color: inherit; font-size: 1.1rem; cursor: pointer; margin-left: 0.5rem; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;">×</button>
				{:else}
					{toast.message}
				{/if}
			</div>
		</div>
	{/if}
</div>
