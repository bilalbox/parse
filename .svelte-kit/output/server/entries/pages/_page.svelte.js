import { f as attr, i as attr_class, o as derived, p as escape_html, s as ensure_array_like } from "../../chunks/internal.js";
import { t as settings } from "../../chunks/settings.svelte.js";
import "../../chunks/toast.svelte.js";
import "../../chunks/navigation.js";
//#region src/lib/cache-convention.ts
var RUNTIME_CACHE = "parse-runtime-v1";
var mediaPattern = /\/media\/[A-Za-z0-9._-]+/g;
/**
* Pull every /media/<key> URL out of stored Article content.
*/
function mediaUrls(content) {
	if (!content) return [];
	return content.match(mediaPattern) || [];
}
/**
* Is this same-origin GET path one we mirror for offline (Article content or media)?
*/
function isRuntimeCacheable(path) {
	return path.startsWith("/api/articles") || path.startsWith("/media/");
}
//#endregion
//#region src/lib/Library.svelte.ts
var DefaultNetworkAdapter = class {
	async fetchList(filter) {
		const qs = filter === "archived" ? "?archived=1" : "";
		const res = await settings.authFetch(`/api/articles${qs}`);
		if (!res.ok) {
			if (res.status === 401) throw new Error("Unauthorized");
			throw new Error("Failed to fetch library");
		}
		return await res.json();
	}
	async search(query) {
		const res = await settings.authFetch(`/api/search?q=${encodeURIComponent(query)}`);
		if (!res.ok) throw new Error("Search failed");
		return await res.json();
	}
	async archive(id, archived) {
		const res = await settings.authFetch(`/api/articles/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ archived })
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			throw new Error(data.error || "Failed to update article");
		}
	}
	async delete(id) {
		const res = await settings.authFetch(`/api/articles/${id}`, { method: "DELETE" });
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			throw new Error(data.error || "Failed to delete article");
		}
	}
};
var DefaultCacheAdapter = class {
	async warm(articles) {
		if (typeof window === "undefined" || !("caches" in window) || !navigator.onLine) return;
		try {
			const cache = await caches.open(RUNTIME_CACHE);
			const keep = /* @__PURE__ */ new Set();
			keep.add("/api/articles");
			for (const article of articles) {
				const contentUrl = `/api/articles/${article.id}`;
				keep.add(contentUrl);
				try {
					let res = await cache.match(contentUrl);
					if (!res) {
						res = await settings.authFetch(contentUrl);
						if (!res.ok) continue;
					}
					const data = await res.clone().json();
					const urls = mediaUrls(JSON.parse(data.content).content);
					for (const m of urls) {
						keep.add(m);
						if (!await cache.match(m)) try {
							await fetch(m);
						} catch {}
					}
				} catch (err) {
					console.warn("Warming article failed:", article.id, err);
				}
			}
			const keys = await cache.keys();
			for (const req of keys) {
				const path = new URL(req.url).pathname;
				if (isRuntimeCacheable(path) && !keep.has(path)) await cache.delete(req);
			}
		} catch (e) {
			console.warn("Offline cache warm failed:", e);
		}
	}
};
var Library = class {
	network;
	cache;
	articles = [];
	query = "";
	filter = "active";
	loading = true;
	error = null;
	#filteredList = derived(() => this.computeFiltered());
	get filteredList() {
		return this.#filteredList();
	}
	set filteredList($$value) {
		return this.#filteredList($$value);
	}
	searchResults = null;
	searchTimeout;
	constructor(network, cache) {
		this.network = network ?? new DefaultNetworkAdapter();
		this.cache = cache ?? new DefaultCacheAdapter();
	}
	async load() {
		this.loading = true;
		this.error = null;
		try {
			const data = await this.network.fetchList(this.filter);
			this.articles = data;
			this.searchResults = null;
			if (this.filter === "active" && settings.isOnline) this.cache.warm(data);
		} catch (err) {
			console.error("Fetch library failed:", err);
			this.error = err;
		} finally {
			this.loading = false;
		}
	}
	search(q) {
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
				this.searchResults = this.articles.filter((a) => a.title && a.title.toLowerCase().includes(trimmed) || a.author && a.author.toLowerCase().includes(trimmed));
			}
		}, 300);
	}
	setFilter(newFilter) {
		this.filter = newFilter;
		this.load();
	}
	async archive(id, archived) {
		await this.network.archive(id, archived);
		await this.load();
	}
	async delete(id) {
		await this.network.delete(id);
		await this.load();
	}
	computeFiltered() {
		if (this.searchResults !== null) return this.searchResults;
		if (this.query.trim()) {
			const trimmed = this.query.trim().toLowerCase();
			return this.articles.filter((a) => a.title && a.title.toLowerCase().includes(trimmed) || a.author && a.author.toLowerCase().includes(trimmed));
		}
		return this.articles;
	}
};
//#endregion
//#region src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const library = new Library();
		$$renderer.push(`<main id="view-dashboard"${attr_class("view", void 0, { "offline": !settings.isOnline })}><header class="app-header"><div class="logo">PARSE</div> <div class="header-actions">`);
		if (settings.deferredInstallPrompt) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<button class="icon-btn" title="Install App">📲</button>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (!settings.isOnline) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<span class="settings-help" style="color: var(--error); margin-right: 0.5rem; font-weight: 500;">Offline</span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <button class="icon-btn" id="add-btn" title="Add URL">+</button> <button class="icon-btn" id="settings-btn" title="Settings">⚙</button> <button class="theme-toggle icon-btn" id="theme-toggle" title="Toggle Theme">◑</button></div></header> <section class="library-section"><div class="library-header"><h2>Library</h2> <div class="library-tools"><div class="filter-toggle" id="filter-toggle"><button${attr_class("filter-btn", void 0, { "active": library.filter === "active" })}>Active</button> <button${attr_class("filter-btn", void 0, { "active": library.filter === "archived" })}>Archived</button></div> <div class="search-box"><input type="text" id="search-input"${attr("value", library.query)} placeholder="Search..."/></div></div></div> <div id="articles-grid" class="articles-grid">`);
		if (library.loading && library.filteredList.length === 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="skeleton-card"></div> <div class="skeleton-card"></div> <div class="skeleton-card"></div>`);
		} else if (library.error && library.filteredList.length === 0) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<p style="color: var(--error); grid-column: 1/-1; text-align: center; padding: 2rem;">${escape_html(library.error.message)}</p>`);
		} else if (library.filteredList.length === 0) {
			$$renderer.push("<!--[2-->");
			$$renderer.push(`<p style="color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 2rem;">${escape_html(library.filter === "archived" ? "No archived articles yet." : "Your library is empty. Start by parsing an article above!")}</p>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--[-->`);
			const each_array = ensure_array_like(library.filteredList);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let article = each_array[$$index];
				$$renderer.push(`<div class="article-card" role="button" tabindex="0"><h3 class="card-title">${escape_html(article.title)}</h3> <div class="card-meta"><span class="author">${escape_html(article.author || "Unknown")}</span> <span class="date">${escape_html(new Date(article.created_at).toLocaleDateString())}</span></div> <div class="card-actions">`);
				if (article.unsubscribe_link) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<button class="card-btn card-unsub" title="Unsubscribe from this newsletter"${attr("disabled", !settings.isOnline, true)}>Unsubscribe</button>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <button class="card-btn card-archive"${attr("disabled", !settings.isOnline, true)}>${escape_html(library.filter === "archived" ? "Unarchive" : "Archive")}</button> <button class="card-btn card-delete"${attr("disabled", !settings.isOnline, true)}>Delete</button></div></div>`);
			}
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></div></section></main> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _page as default };
