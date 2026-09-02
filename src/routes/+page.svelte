<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { settings } from '$lib/settings.svelte';
	import { toast } from '$lib/toast.svelte';
	import { Library } from '$lib/Library.svelte';
	import { readMinutes, formatDate } from '$lib/format';
	import PullToRefresh from '$lib/components/PullToRefresh.svelte';
	import SwipeableCard from '$lib/components/SwipeableCard.svelte';
	import { registerBackOverlay } from '$lib/android-back';
	import Icon from '$lib/components/Icon.svelte';

	const library = new Library();
	
	// Modal and sheet states
	let showAddSheet = $state(false);
	let showSettingsModal = $state(false);
	// The card whose overflow sheet is open, if any. Archive and Delete sat
	// under the thumb on every card during scroll; one deliberate tap now
	// stands between a scroll gesture and permanent loss.
	let menuArticle = $state<any>(null);

	$effect(() => {
		if (!menuArticle) return;
		return registerBackOverlay(() => {
			menuArticle = null;
			return true;
		});
	});
	
	// Form inputs
	let urlToParse = $state('');
	let parsing = $state(false);
	let parseError = $state('');
	


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
		if (!settings.confirmDelete()) return;
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

	/**
	 * Settings has no staged state to commit: both toggles persist the moment
	 * they change. The modal previously offered ×, Cancel and Save Changes as
	 * three routes to the same outcome, one of which claimed to save and one to
	 * cancel. A single Done, and a reload to pick up anything the toggles
	 * changed about the library.
	 */
	function closeSettings(): void {
		showSettingsModal = false;
		library.load();
	}

	async function handleLogout(): Promise<void> {
		try {
			await settings.authFetch('/api/auth/logout', { method: 'POST' });
			await settings.clearNativeSession();
			goto('/login');
		} catch (err) {
			toast.show('Logout failed', 'error');
		}
	}

	onMount(() => {
		document.title = 'Parse | Edge Reading';
		library.load();
		settings.loadUser();
		return registerBackOverlay(() => {
			if (showSettingsModal) {
				showSettingsModal = false;
				return true;
			}
			if (showAddSheet) {
				showAddSheet = false;
				return true;
			}
			return false;
		});
	});

	$effect(() => {
		if (library.error?.message === 'Unauthorized') {
			goto('/login');
		}
	});
</script>

<main id="view-dashboard" class="view" class:offline={!settings.isOnline}>
	<header class="app-header">
		<div class="logo">PARSE</div>
		<div class="header-actions">
			{#if !settings.isOnline}
				<span class="settings-help" style="color: var(--error); margin-right: 0.5rem; font-weight: 500;">Offline</span>
			{/if}
			<button class="icon-btn" id="add-btn" onclick={() => showAddSheet = true} title="Add URL">
				<Icon name="plus" />
			</button>
			<button class="icon-btn" id="settings-btn" onclick={() => showSettingsModal = true} title="Settings">
				<Icon name="settings" />
			</button>
			{#if !settings.einkMode}
				<button class="theme-toggle icon-btn" id="theme-toggle" onclick={() => settings.toggleTheme()} title="Toggle Theme">
					<Icon name="contrast" />
				</button>
			{/if}
		</div>
	</header>

	<PullToRefresh onRefresh={async () => { await library.load(); }}>
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
						<!--
							Swipe is the shortcut past the overflow menu, not a replacement for it:
							left archives, right (further, and through the confirm gate) deletes.
							Off when offline — the actions would fail anyway — and off in e-ink mode,
							where there are no animations to read the gesture by.
						-->
						<SwipeableCard
							enabled={settings.isOnline && !settings.einkMode}
							archiveIcon={library.filter === 'archived' ? 'unarchive' : 'archive'}
							archiveLabel={library.filter === 'archived' ? 'Restore' : 'Archive'}
							onArchive={() => archiveArticle(article.id, library.filter !== 'archived')}
							onDelete={() => deleteArticle(article.id)}
						>
						<div class="article-card" onclick={() => goto(`/article/${article.id}`)} onkeydown={() => {}} role="button" tabindex="0">
							<h3 class="card-title">{article.title}</h3>
							<div class="card-footer">
								<div class="card-meta">
									<span class="author">{article.author || 'Unknown'}</span>
									<span class="card-meta-right">
										<span class="date">{formatDate(article.published) ?? formatDate(article.created_at)}</span>
										{#if article.word_count}
											<span class="read-time">· {readMinutes(article.word_count)} min read</span>
										{/if}
									</span>
								</div>
								<button
									class="icon-btn card-menu-btn"
									onclick={(e) => { e.stopPropagation(); menuArticle = article; }}
									disabled={!settings.isOnline}
									title="Article actions"
								>
									<Icon name="more" />
								</button>
							</div>
						</div>
						</SwipeableCard>
					{/each}
				{/if}
			</div>
		</section>
	</PullToRefresh>

	<footer style="text-align: center; padding: 2rem; padding-top: 0; color: var(--text-secondary); font-size: 0.85rem; font-family: var(--font-ui);">
		<a href="/privacy" style="color: inherit; text-decoration: underline; text-underline-offset: 4px;">Privacy Policy</a>
	</footer>
</main>

<!-- Add URL Bottom Sheet -->
{#if showAddSheet}
	<div id="add-sheet" class="bottom-sheet active">
		<div class="sheet-backdrop" onclick={() => showAddSheet = false} onkeydown={() => {}} role="button" tabindex="-1"></div>
		<div class="sheet-content">
			<div class="sheet-header">
				<h3>New Article</h3>
				<button id="close-sheet" class="icon-btn" onclick={() => showAddSheet = false} title="Close"><Icon name="close" /></button>
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
<div class="bottom-sheet {menuArticle ? 'active' : ''}">
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={() => (menuArticle = null)}></div>
	<div class="sheet-content">
		<div class="sheet-header">
			<h3>Article</h3>
			<button class="icon-btn" onclick={() => (menuArticle = null)} title="Close"><Icon name="close" /></button>
		</div>
		{#if menuArticle}
			<p class="sheet-subject">{menuArticle.title}</p>
			<div class="sheet-actions">
				{#if menuArticle.unsubscribe_link}
					<button class="sheet-action" disabled={!settings.isOnline}
						onclick={() => { const a = menuArticle; menuArticle = null; runUnsubscribe(a.id); }}>
						<Icon name="unsubscribe" />
						<span>Unsubscribe</span>
					</button>
				{/if}
				<button class="sheet-action" disabled={!settings.isOnline}
					onclick={() => { const a = menuArticle; menuArticle = null; archiveArticle(a.id, library.filter !== 'archived'); }}>
					<Icon name={library.filter === 'archived' ? 'unarchive' : 'archive'} />
					<span>{library.filter === 'archived' ? 'Restore to library' : 'Archive'}</span>
				</button>
				<button class="sheet-action sheet-action-danger" disabled={!settings.isOnline}
					onclick={() => { const a = menuArticle; menuArticle = null; deleteArticle(a.id); }}>
					<Icon name="trash" />
					<span>Delete</span>
				</button>
			</div>
		{/if}
	</div>
</div>

{#if showSettingsModal}
	<div id="token-modal" class="modal-overlay">
		<div class="modal-box">
			<div class="modal-header">
				<h2>Settings</h2>
				<button id="settings-close-btn" class="modal-close-btn" onclick={closeSettings} title="Close Settings">
					<Icon name="close" size={18} />
				</button>
			</div>
			
			{#if settings.user}
			<div class="settings-group" style="margin-top: 1rem;">
				<div class="setting-label">Forwarding Address</div>
				<p class="settings-help" style="word-break: break-all;">{settings.user.email_alias}</p>
				<p class="settings-help" style="margin-top: 0.25rem; font-size: 0.8rem;">Emails sent to this address will be saved to your library.</p>
			</div>

			<div class="settings-group">
				<label class="setting-toggle">
					<span class="setting-label">Auto AI Summaries</span>
					<input
						type="checkbox"
						class="switch"
						checked={settings.user.auto_summarize_emails !== 0}
						onchange={(e) => settings.updateUserSettings(e.currentTarget.checked)}
					/>
				</label>
				<p class="settings-help">Automatically generate summaries for incoming newsletter emails.</p>
			</div>
			{/if}

			<div class="settings-group">
				<label class="setting-toggle">
					<span class="setting-label">Confirm Before Deleting</span>
					<input type="checkbox" class="switch" checked={settings.confirmDeletes} onchange={() => settings.toggleConfirmDeletes()} />
				</label>
				<p class="settings-help">Ask before permanently deleting an Article. Turn this off for one-tap deletes — a delete still removes the Article's saved images and cannot be undone.</p>
			</div>

			<div class="settings-group">
				<label class="setting-toggle">
					<span class="setting-label">E-ink Mode</span>
					<input type="checkbox" class="switch" checked={settings.einkMode} onchange={() => settings.toggleEinkMode()} />
				</label>
				<p class="settings-help">High contrast, no animations, page-turn buttons. For e-ink readers like the Supernote Manta.</p>
			</div>

			<div class="modal-footer">
				<button id="logout-btn" class="token-cancel-btn logout-btn" onclick={handleLogout}>Logout</button>
				<button id="token-save-btn" class="token-save-btn" onclick={closeSettings}>Done</button>
			</div>

			<p class="settings-version">Version {settings.appVersion}</p>
		</div>
	</div>
{/if}
