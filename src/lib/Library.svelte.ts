import { settings } from './settings.svelte';
import { RUNTIME_CACHE, isRuntimeCacheable, mediaUrls } from './cache-convention';

export type FilterState = 'active' | 'archived';

export interface ArticleListItem {
	id: string;
	title: string;
	author: string | null;
	url: string;
	unsubscribe_link: string | null;
	archived: number;
	created_at: string;
}

export interface NetworkAdapter {
	fetchList(filter: FilterState): Promise<ArticleListItem[]>;
	search(query: string): Promise<ArticleListItem[]>;
	archive(id: string, archived: boolean): Promise<void>;
	delete(id: string): Promise<void>;
}

export interface CacheAdapter {
	warm(articles: ArticleListItem[]): Promise<void>;
}

function defaultNetworkAdapter(): NetworkAdapter {
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
			if (!res.ok) throw new Error('Search failed');
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
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'Failed to update article');
			}
		},

		async delete(id) {
			const res = await settings.authFetch(`/api/articles/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'Failed to delete article');
			}
		},
	};
}

function defaultCacheAdapter(): CacheAdapter {
	function getRequestUrl(url: string): string {
		let fullUrl = url;
		if (settings.serverUrl && url.startsWith('/')) {
			fullUrl = `${settings.serverUrl}${url}`;
		} else if (url.startsWith('/')) {
			if (typeof window !== 'undefined') {
				fullUrl = `${window.location.origin}${url}`;
			}
		}
		const delimiter = fullUrl.includes('?') ? '&' : '?';
		return settings.token ? `${fullUrl}${delimiter}token=${settings.token}` : fullUrl;
	}

	return {
		async warm(articles: ArticleListItem[]): Promise<void> {
			if (typeof window === 'undefined' || !('caches' in window) || !navigator.onLine) return;
			try {
				const cache = await caches.open(RUNTIME_CACHE);
				const keep = new Set<string>();

				const listUrl = getRequestUrl('/api/articles');
				keep.add(listUrl);

				for (const article of articles) {
					const contentUrl = `/api/articles/${article.id}`;
					const finalContentUrl = getRequestUrl(contentUrl);
					keep.add(finalContentUrl);
					try {
						let res = await cache.match(finalContentUrl);
						if (!res) {
							res = await settings.authFetch(contentUrl);
							if (!res.ok) continue;
						}
						const data = await res.clone().json();
						const payload = JSON.parse(data.content);
						const urls = mediaUrls(payload.content);
						for (const m of urls) {
							const finalMediaUrl = getRequestUrl(m);
							keep.add(finalMediaUrl);
							const cachedMedia = await cache.match(finalMediaUrl);
							if (!cachedMedia) {
								try { await fetch(finalMediaUrl); } catch {}
							}
						}
					} catch (err) {
						console.warn('Warming article failed:', article.id, err);
					}
				}

				const keys = await cache.keys();
				for (const req of keys) {
					if (isRuntimeCacheable(new URL(req.url).pathname) && !keep.has(req.url)) {
						await cache.delete(req);
					}
				}
			} catch (e) {
				console.warn('Offline cache warm failed:', e);
			}
		},
	};
}

export class Library {
	private network: NetworkAdapter;
	private cache: CacheAdapter;

	// Reactive state
	articles = $state<ArticleListItem[]>([]);
	query = $state<string>('');
	filter = $state<FilterState>('active');
	loading = $state<boolean>(true);
	error = $state<Error | null>(null);

	// Derived state
	filteredList = $derived<ArticleListItem[]>(this.computeFiltered());

	// Internal search results when debounced search resolves
	private searchResults = $state<ArticleListItem[] | null>(null);
	private searchTimeout: any;

	constructor(network?: NetworkAdapter, cache?: CacheAdapter) {
		this.network = network ?? defaultNetworkAdapter();
		this.cache = cache ?? defaultCacheAdapter();
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const data = await this.network.fetchList(this.filter);
			this.articles = data;
			this.searchResults = null; // Clear search when reloading list
			
			if (this.filter === 'active' && settings.isOnline) {
				this.cache.warm(data);
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
				this.searchResults = await this.network.search(trimmed);
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

	async archive(id: string, archived: boolean): Promise<void> {
		await this.network.archive(id, archived);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		await this.network.delete(id);
		await this.load();
	}

	private computeFiltered(): ArticleListItem[] {
		if (this.searchResults !== null) {
			return this.searchResults;
		}
		// If no remote search results, we just return the currently loaded articles
		// (which match the active filter by definition from the load() call).
		// Further local filtering for quick typeahead can happen here if desired.
		if (this.query.trim()) {
			const trimmed = this.query.trim().toLowerCase();
			return this.articles.filter(a => 
				(a.title && a.title.toLowerCase().includes(trimmed)) ||
				(a.author && a.author.toLowerCase().includes(trimmed))
			);
		}
		return this.articles;
	}
}
