<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { settings } from '$lib/settings.svelte';
	import { toast } from '$lib/toast.svelte';
	import { Library } from '$lib/Library.svelte';

	const library = new Library();
	
	// Modal and sheet states
	let showAddSheet = $state(false);
	let showSettingsModal = $state(false);
	
	// Form inputs
	let urlToParse = $state('');
	let parsing = $state(false);
	let parseError = $state('');
	
	let settingsToken = $state('');
	let settingsServerUrl = $state('');
	let appUpdateStatus = $state('');
	let checkingUpdates = $state(false);

	// Instead of manual functions, use library instance.
	// But we still need handleParse to run queue inserts
	// runUnsubscribe handles external HTTP calls out of Library scope.

	async function handleParse(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!urlToParse) return;
		if (!settings.isOnline) {
			toast.show('Cannot parse new URLs while offline.', 'error');
			return;
		}

		parsing = true;
		parseError = '';

		try {
			const res = await settings.authFetch('/api/queue', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: urlToParse }),
			});

			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to queue URL');
			}

			toast.show('Added to parse queue! ✓');
			urlToParse = '';
			showAddSheet = false;
			// Reload active articles after queueing
			setTimeout(() => {
				library.load();
			}, 1500);
		} catch (err: any) {
			parseError = err.message || 'Parsing failed';
		} finally {
			parsing = false;
		}
	}

	async function archiveArticle(id: string, archived: boolean): Promise<void> {
		if (!settings.isOnline) {
			toast.show(`Cannot ${archived ? 'archive' : 'unarchive'} while offline.`, 'error');
			return;
		}
		try {
			await library.archive(id, archived);
			toast.show(archived ? 'Archived ✓' : 'Restored to library ✓');
		} catch (err: any) {
			toast.show(err.message || 'Failed to archive article', 'error');
		}
	}

	async function deleteArticle(id: string): Promise<void> {
		if (!settings.isOnline) {
			toast.show('Cannot delete while offline.', 'error');
			return;
		}
		if (!confirm('Delete this article permanently? This also removes its saved images and cannot be undone.')) return;
		try {
			await library.delete(id);
			toast.show('Deleted ✓');
		} catch (err: any) {
			toast.show(err.message || 'Failed to delete article', 'error');
		}
	}

	async function runUnsubscribe(id: string): Promise<void> {
		if (!id) return;
		if (!settings.isOnline) {
			toast.show('Cannot unsubscribe while offline.', 'error');
			return;
		}

		try {
			const res = await settings.authFetch(`/api/articles/${id}/unsubscribe`, { method: 'POST' });
			const data = (await res.json()) as any;
			if (!res.ok) {
				throw new Error(data.error || 'Failed to unsubscribe');
			}

			if (data.action === 'mailto') {
				toast.showLink('Send unsubscribe email via', 'Mail Client', data.link);
			} else if (data.action === 'one-click') {
				toast.show(data.ok ? 'Unsubscribe request sent ✓' : 'Failed to unsubscribe');
			} else if (data.action === 'open') {
				toast.showLink('Open unsubscribe page:', 'Unsubscribe Link', data.link);
			}
		} catch (err: any) {
			toast.show(err.message || 'Failed to unsubscribe', 'error');
		}
	}

	function saveSettings(): void {
		settings.saveToken(settingsToken);
		settings.saveServerUrl(settingsServerUrl);
		showSettingsModal = false;
		library.load().catch((err) => {
			if (err.message === 'Unauthorized') showSettingsModal = true;
		});
	}

	function cancelSettings(): void {
		settingsToken = settings.token;
		settingsServerUrl = settings.serverUrl;
		showSettingsModal = false;
	}

	async function checkUpdates(): Promise<void> {
		if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
			toast.show('Offline updates are not supported in this browser.', 'error');
			return;
		}

		checkingUpdates = true;
		appUpdateStatus = 'Checking...';

		try {
			const registration = await navigator.serviceWorker.getRegistration();
			if (!registration) {
				appUpdateStatus = 'Offline cache is not active yet.';
				checkingUpdates = false;
				return;
			}

			let updateFound = false;
			const onUpdatefound = () => {
				updateFound = true;
				appUpdateStatus = 'Downloading update...';
				
				const installingWorker = registration.installing;
				if (installingWorker) {
					installingWorker.addEventListener('statechange', () => {
						if (installingWorker.state === 'installed') {
							appUpdateStatus = 'Installing update...';
							checkingUpdates = false;
						}
					});
				} else {
					checkingUpdates = false;
				}
			};

			registration.addEventListener('updatefound', onUpdatefound);
			await registration.update();

			setTimeout(() => {
				registration.removeEventListener('updatefound', onUpdatefound);
				if (!updateFound) {
					appUpdateStatus = 'App is up to date.';
					checkingUpdates = false;
				}
			}, 1500);
		} catch (err) {
			console.error('Update check failed:', err);
			appUpdateStatus = 'Check failed. Try again.';
			checkingUpdates = false;
		}
	}

	onMount(() => {
		settingsToken = settings.token;
		settingsServerUrl = settings.serverUrl;
		document.title = 'Parse | Edge Reading';
		library.load().catch((err) => {
			if (err.message === 'Unauthorized') showSettingsModal = true;
		});
	});
</script>

<main id="view-dashboard" class="view" class:offline={!settings.isOnline}>
	<header class="app-header">
		<div class="logo">PARSE</div>
		<div class="header-actions">
			{#if settings.deferredInstallPrompt}
				<button class="icon-btn" onclick={() => settings.installPWA()} title="Install App">📲</button>
			{/if}
			{#if !settings.isOnline}
				<span class="settings-help" style="color: var(--error); margin-right: 0.5rem; font-weight: 500;">Offline</span>
			{/if}
			<button class="icon-btn" id="add-btn" onclick={() => showAddSheet = true} title="Add URL">+</button>
			<button class="icon-btn" id="settings-btn" onclick={() => showSettingsModal = true} title="Settings">⚙</button>
			<button class="theme-toggle icon-btn" id="theme-toggle" onclick={() => settings.toggleTheme()} title="Toggle Theme">◑</button>
		</div>
	</header>

	<section class="library-section">
		<div class="library-header">
			<h2>Library</h2>
			<div class="library-tools">
				<div class="filter-toggle" id="filter-toggle">
					<button class="filter-btn" class:active={library.filter === 'active'} onclick={() => library.setFilter('active')}>Active</button>
					<button class="filter-btn" class:active={library.filter === 'archived'} onclick={() => library.setFilter('archived')}>Archived</button>
				</div>
				<div class="search-box">
					<input type="text" id="search-input" value={library.query} oninput={(e) => library.search(e.currentTarget.value)} placeholder="Search...">
				</div>
			</div>
		</div>
		
		<div id="articles-grid" class="articles-grid">
			{#if library.loading && library.filteredList.length === 0}
				<div class="skeleton-card"></div>
				<div class="skeleton-card"></div>
				<div class="skeleton-card"></div>
			{:else if library.error && library.filteredList.length === 0}
				<p style="color: var(--error); grid-column: 1/-1; text-align: center; padding: 2rem;">
					{library.error.message}
				</p>
			{:else if library.filteredList.length === 0}
				<p style="color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 2rem;">
					{library.filter === 'archived' ? 'No archived articles yet.' : 'Your library is empty. Start by parsing an article above!'}
				</p>
			{:else}
				{#each library.filteredList as article (article.id)}
					<div class="article-card" onclick={() => goto(`/article/${article.id}`)} onkeydown={() => {}} role="button" tabindex="0">
						<h3 class="card-title">{article.title}</h3>
						<div class="card-meta">
							<span class="author">{article.author || 'Unknown'}</span>
							<span class="date">{new Date(article.created_at).toLocaleDateString()}</span>
						</div>
						<div class="card-actions">
							{#if article.unsubscribe_link}
								<button 
									class="card-btn card-unsub" 
									onclick={(e) => { e.stopPropagation(); runUnsubscribe(article.id); }} 
									title="Unsubscribe from this newsletter"
									disabled={!settings.isOnline}
								>
									Unsubscribe
								</button>
							{/if}
							<button 
								class="card-btn card-archive" 
								onclick={(e) => { e.stopPropagation(); archiveArticle(article.id, library.filter !== 'archived'); }}
								disabled={!settings.isOnline}
							>
								{library.filter === 'archived' ? 'Unarchive' : 'Archive'}
							</button>
							<button 
								class="card-btn card-delete" 
								onclick={(e) => { e.stopPropagation(); deleteArticle(article.id); }}
								disabled={!settings.isOnline}
							>
								Delete
							</button>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>
</main>

<!-- Add URL Bottom Sheet -->
{#if showAddSheet}
	<div id="add-sheet" class="bottom-sheet active">
		<div class="sheet-backdrop" onclick={() => showAddSheet = false} onkeydown={() => {}} role="button" tabindex="-1"></div>
		<div class="sheet-content">
			<div class="sheet-header">
				<h3>New Article</h3>
				<button id="close-sheet" class="icon-btn" onclick={() => showAddSheet = false}>✕</button>
			</div>
			<form id="parse-form" class="parse-form" onsubmit={handleParse}>
				<div class="input-group">
					<input type="url" id="url-input" bind:value={urlToParse} placeholder="https://..." required disabled={parsing}>
					<button type="submit" id="submit-btn" disabled={parsing || !settings.isOnline}>
						{#if parsing}
							<div class="spinner"></div>
						{:else}
							<span class="btn-text">Parse</span>
						{/if}
					</button>
				</div>
				{#if parseError}
					<div id="error-message" class="error-msg">{parseError}</div>
				{/if}
			</form>
		</div>
	</div>
{/if}

<!-- Settings Modal -->
{#if showSettingsModal}
	<div id="token-modal" class="modal-overlay">
		<div class="modal-box">
			<div class="modal-header">
				<h2>Settings</h2>
				<button id="settings-close-btn" class="modal-close-btn" onclick={cancelSettings} title="Close Settings">×</button>
			</div>
			
			<div class="settings-group">
				<label for="server-input">Server URL</label>
				<p class="settings-help">The absolute URL of your Cloudflare Worker (e.g. <code>https://parse.yourdomain.com</code>). Leave blank if served from the same domain.</p>
				<input type="url" id="server-input" bind:value={settingsServerUrl} placeholder="https://..." autocomplete="off" spellcheck="false">
			</div>

			<div class="settings-group">
				<label for="token-input">API Token</label>
				<p class="settings-help">Enter your <code>PARSE_TOKEN</code> secret to access your library. This is stored only in your browser.</p>
				<input type="password" id="token-input" bind:value={settingsToken} placeholder="Paste token here..." autocomplete="off" spellcheck="false">
			</div>

			<div class="settings-group">
				<label for="update-btn">App Update</label>
				<p class="settings-help">Pull down the latest version of the app to your device for offline use.</p>
				<div style="display: flex; gap: 0.75rem; align-items: center; margin-top: 0.25rem;">
					<button 
						id="update-btn" 
						class="token-cancel-btn" 
						style="padding: 0.6rem 1rem; font-size: 0.9rem; margin: 0;"
						onclick={checkUpdates}
						disabled={checkingUpdates}
					>
						{checkingUpdates ? 'Checking...' : 'Check for Updates'}
					</button>
					{#if appUpdateStatus}
						<span id="update-status" class="settings-help">{appUpdateStatus}</span>
					{/if}
				</div>
			</div>
			
			<div class="modal-footer">
				<button id="token-cancel-btn" class="token-cancel-btn" onclick={cancelSettings}>Cancel</button>
				<button id="token-save-btn" class="token-save-btn" onclick={saveSettings}>Save Changes</button>
			</div>
		</div>
	</div>
{/if}
