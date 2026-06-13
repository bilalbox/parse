import { a as attr_style, d as unsubscribe_stores, i as attr_class, l as store_get, o as derived, p as attr, u as stringify } from "../../../../chunks/internal.js";
import { t as page } from "../../../../chunks/stores.js";
import { t as settings } from "../../../../chunks/settings.svelte.js";
import { t as tts } from "../../../../chunks/tts.svelte.js";
import "../../../../chunks/toast.svelte.js";
import "../../../../chunks/navigation.js";
//#region src/routes/article/[id]/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		derived(() => store_get($$store_subs ??= {}, "$page", page).params.id);
		$$renderer.push(`<main id="view-article" class="view active"><nav class="app-header reader-header"><button class="icon-btn" title="Back to Library">←</button> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></nav> <div id="reader-content"${attr_class("reader-content", void 0, {
			"rtl-content": tts.isArabicContent,
			"typography-sans": settings.fontFamily === "sans",
			"typography-serif": settings.fontFamily === "serif",
			"typography-amiri": settings.fontFamily === "amiri",
			"typography-cairo": settings.fontFamily === "cairo"
		})}${attr("dir", tts.isArabicContent ? "rtl" : "ltr")}${attr_style("", { "font-size": `${stringify(settings.fontSize)}rem` })}>`);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="reader-loading"><div class="spinner large"></div></div>`);
		$$renderer.push(`<!--]--></div></main>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
