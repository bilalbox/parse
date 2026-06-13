<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { settings } from '$lib/settings.svelte';
	import { toast } from '$lib/toast.svelte';
	import { RUNTIME_CACHE, isRuntimeCacheable, mediaUrls } from '$lib/cache-convention';

	// Svelte 5 States
	let articlesCache = $state<any[]>([]);
	let loading = $state(true);
	let filter = $state<'active' | 'archived'>('active');
	let searchQuery = $state('');
	
	// Modal and sheet states
	let showAddSheet = $state(false);
	let showSettingsModal = $state(false);
	
	// Form inputs
	let urlToParse = $state('');
	let parsing = $state(false);
	let parseError = $state('');
	
	let settingsToken = $state('');
	let appUpdateStatus = $state('');
	let checkingUpdates = $state(false);

	// Debounced Search using Svelte 5 Effect
	let searchResults = $state<any[] | null>(null);

	$effect(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) {
			searchResults = null;
			return;
		}

		const timer = setTimeout(async () => {
			try {
				const res = await settings.authFetch(`/api/search?q=${encodeURIComponent(query)}`);
				if (res.ok) {
					searchResults = (await res.json()) as any[];
				} else {
					throw new Error();
				}
			} catch {
				// Local offline fallback: filter cached list
				searchResults = articlesCache.filter(a => 
					(a.title && a.title.toLowerCase().includes(query)) ||
					(a.author && a.author.toLowerCase().includes(query))
				);
			}
		}, 300);

		return () => clearTimeout(timer);
	});

	// Derived Articles to display
	let displayedArticles = $derived(searchResults !== null ? searchResults : articlesCache);

	async function fetchLibrary(): Promise<void> {
		loading = true;
		try {
			const qs = filter === 'archived' ? '?archived=1' : '';
			const res = await settings.authFetch(`/api/articles${qs}`);
			if (!res.ok) {
				if (res.status === 401) {
					// Token required or invalid, prompt settings
					showSettingsModal = true;
					return;
				}
				throw new Error('Failed to fetch library');
			}
			const data = (await res.json()) as any[];
			articlesCache = data;
			
			// Warm offline cache if active list is fetched online
			if (filter === 'active' && settings.isOnline) {
				warmOfflineCache(data);
			}
		} catch (err) {
			console.error('Fetch library failed:', err);
		} finally {
			loading = false;
		}
	}

	async function warmOfflineCache(articles: any[]): Promise<void> {
		if (typeof window === 'undefined' || !('caches' in window) || !navigator.onLine) return;
		
		try {
			const cache = await caches.open(RUNTIME_CACHE);
			const keep = new Set<string>();
			
			// The list response itself must survive eviction
			keep.add('/api/articles');
			
			for (const article of articles) {
				const contentUrl = `/api/articles/${article.id}`;
				keep.add(contentUrl);
				
				try {
					let res = await cache.match(contentUrl);
					if (!res) {
						res = await settings.authFetch(contentUrl);
						if (!res.ok) continue;
					}
					const data = (await res.clone().json()) as any;
					const payload = JSON.parse(data.content);
					
					// Warm the media
					const urls = mediaUrls(payload.content);
					for (const m of urls) {
						keep.add(m);
						const cachedMedia = await cache.match(m);
						if (!cachedMedia) {
							try { await fetch(m); } catch {}
						}
					}
				} catch (err) {
					console.warn('Warming article failed:', article.id, err);
				}
			}
			
			// Evict stale cache items
			const keys = await cache.keys();
			for (const req of keys) {
				const path = new URL(req.url).pathname;
				if (isRuntimeCacheable(path) && !keep.has(path)) {
					await cache.delete(req);
				}
			}
		} catch (e) {
			console.warn('Offline cache warm failed:', e);
		}
	}

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
				fetchLibrary();
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
			const res = await settings.authFetch(`/api/articles/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ archived }),
			});
			
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to update article');
			}

			toast.show(archived ? 'Archived ✓' : 'Restored to library ✓');
			await fetchLibrary();
		} catch (err: any) {
			toast.show(err.message || 'Failed to archive article', 'error');
		}
	}

	async function deleteArticle(id: string): Promise<void> {
		if (!id) return;
		if (!settings.isOnline) {
			toast.show('Cannot delete while offline.', 'error');
			return;
		}

		if (!confirm('Delete this article permanently? This also removes its saved images and cannot be undone.')) return;

		try {
			const res = await settings.authFetch(`/api/articles/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to delete article');
			}

			toast.show('Deleted ✓');
			await fetchLibrary();
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

	function setFilter(newFilter: 'active' | 'archived'): void {
		filter = newFilter;
		fetchLibrary();
	}

	function saveSettings(): void {
		settings.saveToken(settingsToken);
		showSettingsModal = false;
		fetchLibrary();
	}

	function cancelSettings(): void {
		settingsToken = settings.token;
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
						}
					});
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
		document.title = 'Parse | Edge Reading';
		fetchLibrary();
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
					<button class="filter-btn" class:active={filter === 'active'} onclick={() => setFilter('active')}>Active</button>
					<button class="filter-btn" class:active={filter === 'archived'} onclick={() => setFilter('archived')}>Archived</button>
				</div>
				<div class="search-box">
					<input type="text" id="search-input" bind:value={searchQuery} placeholder="Search...">
				</div>
			</div>
		</div>
		
		<div id="articles-grid" class="articles-grid">
			{#if loading}
				<div class="skeleton-card"></div>
				<div class="skeleton-card"></div>
				<div class="skeleton-card"></div>
			{:else if displayedArticles.length === 0}
				<p style="color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 2rem;">
					{filter === 'archived' ? 'No archived articles yet.' : 'Your library is empty. Start by parsing an article above!'}
				</p>
			{:else}
				{#each displayedArticles as article (article.id)}
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
								onclick={(e) => { e.stopPropagation(); archiveArticle(article.id, filter !== 'archived'); }}
								disabled={!settings.isOnline}
							>
								{filter === 'archived' ? 'Unarchive' : 'Archive'}
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
