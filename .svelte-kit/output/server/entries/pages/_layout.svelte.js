import { a as attr_style, c as slot, d as unsubscribe_stores, i as attr_class, m as escape_html, p as attr, s as ensure_array_like, u as stringify } from "../../chunks/internal.js";
import "../../chunks/stores.js";
import "../../chunks/settings.svelte.js";
import { t as tts } from "../../chunks/tts.svelte.js";
import { t as toast } from "../../chunks/toast.svelte.js";
//#region src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let voiceSelectValue = "";
		$$renderer.push(`<div id="layout-root" style="width: 100%; height: 100%; position: relative;"><!---->`);
		$$renderer.push(`<div style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;"><!--[-->`);
		slot($$renderer, $$props, "default", {}, null);
		$$renderer.push(`<!--]--></div>`);
		$$renderer.push(`<!----> `);
		if (tts.visible) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div id="tts-player" class="tts-player-panel active"><div class="player-blur-bg"></div> <div class="player-progress-container" id="player-progress-area" role="slider"${attr("aria-valuenow", tts.currentIndex)}${attr("aria-valuemin", 0)}${attr("aria-valuemax", tts.sentences.length)} tabindex="0"><div class="player-progress-bar" id="player-progress"${attr_style(`width: ${stringify(tts.sentences.length > 0 ? tts.currentIndex / tts.sentences.length * 100 : 0)}%`)}></div></div> <div class="player-content"><div class="player-info"><div class="player-artwork" id="player-art">`);
			if (tts.featuredImage) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<img${attr("src", tts.featuredImage)} alt="Cover Art" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;"/>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<span class="player-art-icon">🎙️</span>`);
			}
			$$renderer.push(`<!--]--></div> <div class="player-metadata"><div class="player-title" id="player-title">${escape_html(tts.articleTitle)}</div> <div class="player-author" id="player-author">${escape_html(tts.articleAuthor ? `By ${tts.articleAuthor}` : "Unknown Author")}</div></div></div> <div class="player-controls-group"><button class="player-icon-btn" title="Previous Sentence">⏮</button> <button class="player-icon-btn" title="Rewind 15s">⏪</button> <button class="player-icon-btn player-play-btn"${attr("title", tts.isPlaying ? "Pause" : "Play")}>${escape_html(tts.isPlaying ? "⏸" : "▶")}</button> <button class="player-icon-btn" title="Forward 15s">⏩</button> <button class="player-icon-btn" title="Next Sentence">⏭</button></div> <div class="player-extra"><div class="select-wrapper">`);
			$$renderer.select({
				value: tts.selectedSpeed,
				onchange: (e) => tts.setSpeed(parseFloat(e.currentTarget.value)),
				class: "player-select",
				title: "Playback Speed"
			}, ($$renderer) => {
				$$renderer.option({ value: "0.5" }, ($$renderer) => {
					$$renderer.push(`0.5x`);
				});
				$$renderer.option({ value: "0.75" }, ($$renderer) => {
					$$renderer.push(`0.75x`);
				});
				$$renderer.option({ value: "1" }, ($$renderer) => {
					$$renderer.push(`1.0x`);
				});
				$$renderer.option({ value: "1.2" }, ($$renderer) => {
					$$renderer.push(`1.2x`);
				});
				$$renderer.option({ value: "1.5" }, ($$renderer) => {
					$$renderer.push(`1.5x`);
				});
				$$renderer.option({ value: "1.75" }, ($$renderer) => {
					$$renderer.push(`1.75x`);
				});
				$$renderer.option({ value: "2" }, ($$renderer) => {
					$$renderer.push(`2.0x`);
				});
			});
			$$renderer.push(`</div> <div class="select-wrapper">`);
			$$renderer.select({
				value: voiceSelectValue,
				onchange: (e) => tts.setVoice(e.currentTarget.value),
				class: "player-select",
				title: "Voice Selection",
				disabled: !tts.hasVoice
			}, ($$renderer) => {
				if (!tts.hasVoice) {
					$$renderer.push("<!--[0-->");
					$$renderer.option({ value: "" }, ($$renderer) => {
						$$renderer.push(`No voice installed`);
					});
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--[-->`);
					const each_array = ensure_array_like(tts.getUsableVoices());
					for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
						let voice = each_array[$$index];
						$$renderer.option({ value: voice.name }, ($$renderer) => {
							$$renderer.push(`🗣️ ${escape_html(voice.name)} (${escape_html(voice.lang)})`);
						});
					}
					$$renderer.push(`<!--]-->`);
				}
				$$renderer.push(`<!--]-->`);
			});
			$$renderer.push(`</div> <button class="player-close-btn" title="Close Player">×</button></div></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (toast.visible) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="toast-container" style="position: fixed; bottom: 84px; right: 24px; z-index: 9999;"><div${attr_class(`toast ${toast.type === "error" ? "toast-error" : ""}`)} style="margin: 0;">`);
			if (toast.href) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<span style="margin-right: 0.5rem;">${escape_html(toast.message)}</span> <a${attr("href", toast.href)} class="toast-link" target="_blank" rel="noopener noreferrer">${escape_html(toast.linkText)}</a> <button style="background: transparent; border: none; color: inherit; font-size: 1.1rem; cursor: pointer; margin-left: 0.5rem; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;">×</button>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`${escape_html(toast.message)}`);
			}
			$$renderer.push(`<!--]--></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _layout as default };
