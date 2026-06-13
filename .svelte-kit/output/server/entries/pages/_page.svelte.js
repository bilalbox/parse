import { f as attr, i as attr_class, o as derived } from "../../chunks/internal.js";
import { t as settings } from "../../chunks/settings.svelte.js";
import "../../chunks/toast.svelte.js";
import "../../chunks/navigation.js";
//#endregion
//#region src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let articlesCache = [];
		let searchQuery = "";
		derived(() => articlesCache);
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
		$$renderer.push(`<!--]--> <button class="icon-btn" id="add-btn" title="Add URL">+</button> <button class="icon-btn" id="settings-btn" title="Settings">⚙</button> <button class="theme-toggle icon-btn" id="theme-toggle" title="Toggle Theme">◑</button></div></header> <section class="library-section"><div class="library-header"><h2>Library</h2> <div class="library-tools"><div class="filter-toggle" id="filter-toggle"><button${attr_class("filter-btn", void 0, { "active": true })}>Active</button> <button${attr_class("filter-btn", void 0, { "active": false })}>Archived</button></div> <div class="search-box"><input type="text" id="search-input"${attr("value", searchQuery)} placeholder="Search..."/></div></div></div> <div id="articles-grid" class="articles-grid">`);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="skeleton-card"></div> <div class="skeleton-card"></div> <div class="skeleton-card"></div>`);
		$$renderer.push(`<!--]--></div></section></main> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _page as default };
