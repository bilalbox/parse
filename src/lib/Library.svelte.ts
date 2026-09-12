import { settings } from './settings.svelte';
import { toast } from './toast.svelte';
import { RUNTIME_CACHE, isRuntimeCacheable, mediaUrls } from './cache-convention';
import { parseArticleContent } from './article-content';

export type FilterState = 'active' | 'archived';

export interface ArticleListItem {
	id: string;
	title: string;
	author: string | null;
	url: string;
	unsubscribe_link: string | null;
	archived: number;
	published: string | null;
	word_count: number | null;
	created_at: string;
}

export type UnsubscribeOutcome =
	| { action: 'mailto'; link: string }
	| { action: 'one-click'; ok: boolean; status?: number }
	| { action: 'open'; link: string };

export function presentUnsubscribeOutcome(outcome: UnsubscribeOutcome): void {
	if (outcome.action === 'mailto') {
		toast.showLink('Send unsubscribe email via', 'Mail Client', outcome.link);
	} else if (outcome.action === 'one-click') {
		toast.show(outcome.ok ? 'Unsubscribe request sent ✓' : 'Failed to unsubscribe');
	} else if (outcome.action === 'open') {
		toast.showLink('Open unsubscribe page:', 'Unsubscribe Link', outcome.link);
	}
}

export interface LibraryClient {
	fetchList(filter: FilterState): Promise<ArticleListItem[]>;
	search(query: string): Promise<ArticleListItem[]>;
	archive(id: string, archived: boolean): Promise<void>;
	delete(id: string): Promise<void>;
	queue(url: string): Promise<void>;
	unsubscribe(id: string): Promise<UnsubscribeOutcome>;
}

function defaultLibraryClient(): LibraryClient {
	return {
		async fetchList(filter) {
			const qs = filter === 'archived' ? '?archived=1' : '';
			const res = await settings.authFetch(`/api/articles${qs}`);
			if (!res.ok) {
				if (res.status === 401) throw new Error('Unauthorized');
				throw new Error('Failed to fetch library');
			}
			const contentType = res.headers.get('content-type');
			if (contentType && contentType.includes('text/html')) {
				throw new Error('Server configuration error: received HTML instead of JSON. Please check your Server URL and token.');
			}
			return (await res.json()) as ArticleListItem[];
		},

		async search(query) {
			const res = await settings.authFetch(`/api/search?q=${encodeURIComponent(query)}`);
			if (!res.ok) {
				if (res.status === 401) throw new Error('Unauthorized');
				throw new Error('Search failed');
			}
			const contentType = res.headers.get('content-type');
			if (contentType && contentType.includes('text/html')) {
				throw new Error('Search failed: Server configuration error');
			}
			return (await res.json()) as ArticleListItem[];
		},

		async archive(id, archived) {
			const res = await settings.authFetch(`/api/articles/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ archived }),
			});
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to update article');
			}
		},

		async delete(id) {
			const res = await settings.authFetch(`/api/articles/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to delete article');
			}
		},

		async queue(url) {
			const res = await settings.authFetch('/api/queue', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url }),
			});
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to queue URL');
			}
		},

		async unsubscribe(id) {
			const res = await settings.authFetch(`/api/articles/${id}/unsubscribe`, { method: 'POST' });
			const data = (await res.json().catch(() => ({}))) as any;
			if (!res.ok) {
				throw new Error(data.error || 'Failed to unsubscribe');
			}
			return data as UnsubscribeOutcome;
		}
	};
}

function getRequestUrl(url: string): string {
	let fullUrl = url;
	if (url.startsWith('/')) {
		if (typeof window !== 'undefined') {
			fullUrl = `${window.location.origin}${url}`;
		}
	}
	return fullUrl;
}

export class Library {
	private client: LibraryClient;
	private syncAbortController: AbortController | null = null;

	// Reactive state
	articles = $state<ArticleListItem[]>([]);
	query = $state<string>('');
	filter = $state<FilterState>('active');
	loading = $state<boolean>(true);
	error = $state<Error | null>(null);

	// Tombstone set for pending deletions (prevents re-fetch race condition)
	pendingDeletions = $state<Set<string>>(new Set());

	// Derived state
	filteredList = $derived<ArticleListItem[]>(this.computeFiltered());

	// Internal search results when debounced search resolves
	private searchResults = $state<ArticleListItem[] | null>(null);
	private searchTimeout: any;

	constructor(client?: LibraryClient) {
		this.client = client ?? defaultLibraryClient();
	}

	abortSync(): void {
		if (this.syncAbortController) {
			this.syncAbortController.abort();
			this.syncAbortController = null;
		}
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const data = await this.client.fetchList(this.filter);
			this.articles = data.filter(a => !this.pendingDeletions.has(a.id));
			this.searchResults = null;

			if (this.filter === 'active' && settings.isOnline) {
				this.abortSync();
				this.syncAbortController = new AbortController();
				void this.syncOfflineCache(this.articles, this.syncAbortController.signal);
			}
		} catch (err: any) {
			console.error('Fetch library failed:', err);
			this.error = err;
		} finally {
			this.loading = false;
		}
	}

	search(q: string): void {
		this.query = q;
		const trimmed = q.trim().toLowerCase();
		if (!trimmed) {
			this.searchResults = null;
			if (this.searchTimeout) clearTimeout(this.searchTimeout);
			return;
		}

		if (this.searchTimeout) clearTimeout(this.searchTimeout);
		this.searchTimeout = setTimeout(async () => {
			try {
				this.searchResults = await this.client.search(trimmed);
			} catch {
				// Local offline fallback
				this.searchResults = this.articles.filter(a =>
					(a.title && a.title.toLowerCase().includes(trimmed)) ||
					(a.author && a.author.toLowerCase().includes(trimmed))
				);
			}
		}, 300);
	}

	setFilter(newFilter: FilterState): void {
		this.filter = newFilter;
		this.load();
	}

	async add(url: string): Promise<void> {
		if (!url) return;
		if (!settings.isOnline) {
			throw new Error('Cannot parse new URLs while offline.');
		}
		await this.client.queue(url);
		// Reload active articles after a short grace period for worker processing
		setTimeout(() => {
			this.load();
		}, 1500);
	}

	async archive(id: string, archived: boolean): Promise<void> {
		if (!settings.isOnline) {
			throw new Error(`Cannot ${archived ? 'archive' : 'unarchive'} while offline.`);
		}
		await this.client.archive(id, archived);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		if (!settings.isOnline) {
			throw new Error('Cannot delete while offline.');
		}

		// 1. Optimistic removal
		const originalIndex = this.articles.findIndex(a => a.id === id);
		const removedArticle = this.articles[originalIndex];
		this.pendingDeletions.add(id);
		this.articles = this.articles.filter(a => a.id !== id);

		// 2. Perform backend delete & cache eviction
		try {
			await Promise.all([
				this.client.delete(id),
				this.evictFromCache(id)
			]);
			this.pendingDeletions.delete(id);
		} catch (err) {
			// 3. Rollback on failure
			this.pendingDeletions.delete(id);
			if (removedArticle) {
				this.articles.splice(originalIndex, 0, removedArticle);
			}
			throw err;
		}
	}

	async unsubscribe(id: string): Promise<UnsubscribeOutcome> {
		if (!id) throw new Error('Article ID is required');
		if (!settings.isOnline) {
			throw new Error('Cannot unsubscribe while offline.');
		}
		return this.client.unsubscribe(id);
	}

	private computeFiltered(): ArticleListItem[] {
		const base = this.searchResults !== null ? this.searchResults : this.articles;
		const activeItems = base.filter(a => !this.pendingDeletions.has(a.id));

		if (this.query.trim()) {
			const trimmed = this.query.trim().toLowerCase();
			return activeItems.filter(a =>
				(a.title && a.title.toLowerCase().includes(trimmed)) ||
				(a.author && a.author.toLowerCase().includes(trimmed))
			);
		}
		return activeItems;
	}

	/**
	 * Synchronize the active library into Cache Storage (ADR-0002).
	 *
	 * Preserves all active articles (1..N) in the keep set so that download
	 * batching never causes uncached or later active items to be purged.
	 */
	private async syncOfflineCache(articles: ArticleListItem[], signal?: AbortSignal): Promise<void> {
		if (typeof window === 'undefined' || !('caches' in window) || !navigator.onLine) return;
		try {
			const cache = await caches.open(RUNTIME_CACHE);
			const keep = new Set<string>();

			const listUrl = getRequestUrl('/api/articles');
			keep.add(listUrl);

			// 1. Register ALL active articles and their existing cached media in keep set.
			// This fixes the bug where batching (articles.slice(0, 20)) prematurely evicted
			// active articles 21-200.
			for (const article of articles) {
				const contentUrl = getRequestUrl(`/api/articles/${article.id}`);
				keep.add(contentUrl);

				try {
					const cached = await cache.match(contentUrl);
					if (cached) {
						const data = (await cached.clone().json().catch(() => ({}))) as any;
						if (data.content) {
							const urls = mediaUrls(parseArticleContent(data.content).html);
							for (const m of urls) {
								keep.add(getRequestUrl(m));
							}
						}
					}
				} catch {}
			}

			// 2. Bound download warming of uncached items to top 20 to conserve bandwidth
			const warmBatch = articles.slice(0, 20);
			for (const article of warmBatch) {
				if (signal?.aborted) return;
				const contentUrl = `/api/articles/${article.id}`;
				const finalContentUrl = getRequestUrl(contentUrl);
				keep.add(finalContentUrl);

				try {
					let res = await cache.match(finalContentUrl);
					if (!res) {
						res = await settings.authFetch(contentUrl, { signal });
						if (!res.ok) continue;
						await cache.put(finalContentUrl, res.clone());
					}
					const data = (await res.clone().json()) as any;
					if (data.content) {
						const urls = mediaUrls(parseArticleContent(data.content).html);
						for (const m of urls) {
							if (signal?.aborted) return;
							const finalMediaUrl = getRequestUrl(m);
							keep.add(finalMediaUrl);
							const cachedMedia = await cache.match(finalMediaUrl);
							if (!cachedMedia) {
								try {
									const mediaRes = await fetch(finalMediaUrl, { signal });
									if (mediaRes.ok) {
										await cache.put(finalMediaUrl, mediaRes.clone());
									}
								} catch {}
							}
						}
					}
				} catch (err: any) {
					if (err.name === 'AbortError') return;
					console.warn('Warming article failed:', article.id, err);
				}
			}

			// 3. Evict only runtime-cacheable assets that are no longer in the active keep set
			if (!signal?.aborted) {
				const keys = await cache.keys();
				for (const req of keys) {
					if (isRuntimeCacheable(new URL(req.url).pathname) && !keep.has(req.url)) {
						await cache.delete(req);
					}
				}
			}
		} catch (e: any) {
			if (e.name === 'AbortError') return;
			console.warn('Offline cache sync failed:', e);
		}
	}

	private async evictFromCache(id: string): Promise<void> {
		if (typeof window === 'undefined' || !('caches' in window)) return;
		try {
			const cache = await caches.open(RUNTIME_CACHE);
			const contentUrl = getRequestUrl(`/api/articles/${id}`);
			const match = await cache.match(contentUrl);
			if (match) {
				try {
					const data = (await match.clone().json()) as any;
					if (data.content) {
						const urls = mediaUrls(parseArticleContent(data.content).html);
						for (const u of urls) {
							await cache.delete(getRequestUrl(u));
						}
					}
				} catch {}
			}
			await cache.delete(contentUrl);
		} catch (e) {
			console.warn('Evicting article from cache failed:', id, e);
		}
	}
}

export const library = new Library();
