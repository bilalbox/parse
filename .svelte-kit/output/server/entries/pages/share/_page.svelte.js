import { d as unsubscribe_stores, m as escape_html } from "../../../chunks/internal.js";
import "../../../chunks/stores.js";
import "../../../chunks/settings.svelte.js";
import "../../../chunks/navigation.js";
//#region src/routes/share/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let status = "Clipping...";
		$$renderer.push(`<main id="view-clipping" class="view active"><div class="clipping-container">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div id="clipping-spinner" class="spinner large"></div>`);
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <h2 id="clipping-status">${escape_html(status)}</h2> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		$$renderer.push(`<!--]--></div></main>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
