import "./internal.js";
//#region src/lib/tts.svelte.ts
var ABBREVIATIONS = new Set([
	"mr",
	"mrs",
	"ms",
	"dr",
	"prof",
	"sr",
	"jr",
	"st",
	"vs",
	"e.g",
	"i.e",
	"u.s"
]);
function endsWithAbbreviation(chunk) {
	const trimmed = chunk.trimEnd();
	if (!/[^.!?]\.$/.test(trimmed)) return false;
	const word = trimmed.match(/(\S+)\.$/)?.[1] ?? "";
	return /^[A-Z]$/.test(word) || ABBREVIATIONS.has(word.toLowerCase());
}
/**
* Locale-aware sentence segmentation via the platform ICU segmenter.
* Returns contiguous, literal slices of `text` (they tile it exactly).
*/
function segmentSentences(text, locale) {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) return [...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text)].map((s) => s.segment);
	const terminators = locale === "ar" ? ".!?\\u061F\\u06D4" : ".!?";
	return text.match(new RegExp(`[\\s\\S]*?[${terminators}]+(?:\\s+|$)|[\\s\\S]+$`, "g")) || [];
}
var TTSManager = class {
	sentences = [];
	currentIndex = -1;
	isPlaying = false;
	selectedVoice = "";
	selectedSpeed = 1;
	hasVoice = false;
	articleId = null;
	articleTitle = "";
	articleAuthor = "";
	featuredImage = "";
	isArabicContent = false;
	visible = false;
	currentUtterance = null;
	allVoices = [];
	constructor() {
		if (typeof window !== "undefined") {
			const storedSpeed = localStorage.getItem("tts_speed");
			if (storedSpeed) this.selectedSpeed = parseFloat(storedSpeed);
			if ("speechSynthesis" in window) {
				window.speechSynthesis.onvoiceschanged = () => {
					this.initVoices();
				};
				this.initVoices();
			}
		}
	}
	get contentLang() {
		return this.isArabicContent ? "ar" : "en";
	}
	initVoices() {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		const supported = window.speechSynthesis.getVoices().filter((v) => v.lang && /^(en|ar)/i.test(v.lang));
		const byLocale = /* @__PURE__ */ new Map();
		for (const v of supported) {
			const locale = v.lang.toLowerCase();
			const isNetwork = /network/i.test(v.name);
			const existing = byLocale.get(locale);
			if (!existing || /network/i.test(existing.name) && !isNetwork) byLocale.set(locale, v);
		}
		this.allVoices = [...byLocale.values()].sort((a, b) => a.lang.localeCompare(b.lang));
		this.resolveVoice();
	}
	getUsableVoices() {
		return this.allVoices.filter((v) => v.lang.toLowerCase().startsWith(this.contentLang));
	}
	/** Pick the active voice for the current content language, honouring the saved preference. */
	resolveVoice() {
		const usable = this.getUsableVoices();
		this.hasVoice = usable.length > 0;
		const stored = localStorage.getItem(`tts_voice_${this.contentLang}`);
		if (stored && usable.some((v) => v.name === stored)) this.selectedVoice = stored;
		else if (usable.length > 0) this.selectedVoice = usable[0].name;
		else this.selectedVoice = "";
	}
	setSpeed(speed) {
		this.selectedSpeed = speed;
		localStorage.setItem("tts_speed", speed.toString());
		if (this.isPlaying) this.playSentence(this.currentIndex);
	}
	setVoice(voiceName) {
		this.selectedVoice = voiceName;
		localStorage.setItem(`tts_voice_${this.contentLang}`, voiceName);
		if (this.isPlaying) this.playSentence(this.currentIndex);
	}
	cancelLocalSpeech() {
		if (this.currentUtterance) {
			this.currentUtterance.onend = null;
			this.currentUtterance.onerror = null;
			this.currentUtterance = null;
		}
		if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
	}
	loadArticle(articleId, title, author, container) {
		if (this.articleId !== articleId) this.stop();
		this.articleId = articleId;
		this.articleTitle = title;
		this.articleAuthor = author;
		const img = container.querySelector(".featured-image-container img, img");
		this.featuredImage = img ? img.src : "";
		const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
		this.isArabicContent = arabicPattern.test(container.textContent || "") || arabicPattern.test(title || "");
		this.resolveVoice();
		this.sentences = this.prepareTtsContent(container);
		if (this.isPlaying && this.articleId === articleId) this.highlightSentence(this.currentIndex);
		else this.currentIndex = 0;
		this.updateMediaSession();
	}
	/**
	* Split a block of text into sentences using the platform's locale-aware
	* segmenter, then re-join title/initial over-splits (e.g. "Mr.", "J.") for
	* English. Returns literal, contiguous slices of `text` (span-mapper relies on it).
	*/
	splitIntoSentences(text) {
		const chunks = segmentSentences(text, this.contentLang);
		return this.contentLang === "ar" ? chunks : this.mergeAbbreviations(chunks);
	}
	/** Re-join chunks split at a title or initial, e.g. "Mr." + "Smith said hi." */
	mergeAbbreviations(chunks) {
		const merged = [];
		for (const chunk of chunks) {
			const prev = merged[merged.length - 1];
			if (prev !== void 0 && endsWithAbbreviation(prev)) merged[merged.length - 1] = prev + chunk;
			else merged.push(chunk);
		}
		return merged;
	}
	prepareTtsContent(container) {
		const sentences = [];
		let sentenceCount = 0;
		const blockSelector = "p, li, blockquote, h1, h2, h3, h4, h5, h6, summary";
		const skipSelector = ".parsed-action-links, .parsed-rescued-images";
		Array.from(container.querySelectorAll(blockSelector)).filter((el) => !el.closest(skipSelector)).forEach((block) => {
			const textNodesInBlock = [];
			const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
			let node;
			while (node = walk.nextNode()) textNodesInBlock.push(node);
			const blockText = block.textContent || "";
			const blockSentences = this.splitIntoSentences(blockText);
			if (blockSentences.length === 0) return;
			let textNodesOffset = 0;
			const nodeDetails = textNodesInBlock.map((n) => {
				const details = {
					node: n,
					start: textNodesOffset,
					end: textNodesOffset + n.length
				};
				textNodesOffset += n.length;
				return details;
			});
			textNodesInBlock.forEach((node) => {
				const parent = node.parentElement;
				if (!parent) return;
				const details = nodeDetails.find((d) => d.node === node);
				if (!details) return;
				const nodeStart = details.start;
				const nodeLength = node.length;
				const nodeText = node.textContent || "";
				const fragment = document.createDocumentFragment();
				let nodeOffset = 0;
				for (let sentenceIdx = 0; sentenceIdx < blockSentences.length; sentenceIdx++) {
					const currentSentenceStart = blockSentences.slice(0, sentenceIdx).reduce((acc, s) => acc + s.length, 0);
					const sText = blockSentences[sentenceIdx];
					const sStartInBlock = blockText.indexOf(sText, currentSentenceStart);
					const sEndInBlock = sStartInBlock + sText.length;
					const absNodeOffset = nodeStart + nodeOffset;
					if (absNodeOffset < sStartInBlock) {
						const len = Math.min(sStartInBlock - absNodeOffset, nodeLength - nodeOffset);
						fragment.appendChild(document.createTextNode(nodeText.substring(nodeOffset, nodeOffset + len)));
						nodeOffset += len;
					} else if (absNodeOffset >= sStartInBlock && absNodeOffset < sEndInBlock) {
						const len = Math.min(sEndInBlock - absNodeOffset, nodeLength - nodeOffset);
						const matchText = nodeText.substring(nodeOffset, nodeOffset + len);
						const span = document.createElement("span");
						span.className = "tts-sentence";
						const globalIdx = sentenceCount + sentenceIdx;
						span.dataset.sentenceIndex = globalIdx.toString();
						span.textContent = matchText;
						fragment.appendChild(span);
						if (!sentences[globalIdx]) sentences[globalIdx] = {
							text: sText,
							elements: []
						};
						sentences[globalIdx].elements.push(span);
						nodeOffset += len;
					}
				}
				if (nodeOffset < nodeLength) fragment.appendChild(document.createTextNode(nodeText.substring(nodeOffset)));
				parent.replaceChild(fragment, node);
			});
			sentenceCount += blockSentences.length;
		});
		return sentences;
	}
	showPlayer() {
		this.visible = true;
	}
	hidePlayer() {
		this.stop();
		this.visible = false;
	}
	togglePlay() {
		if (this.isPlaying) this.pause();
		else this.play();
	}
	play() {
		if (this.sentences.length === 0) return;
		this.isPlaying = true;
		this.visible = true;
		this.updateMediaSession();
		this.playSentence(this.currentIndex);
	}
	pause() {
		this.isPlaying = false;
		this.cancelLocalSpeech();
		this.updateMediaSession();
	}
	stop() {
		this.isPlaying = false;
		this.cancelLocalSpeech();
		this.clearHighlight();
		this.currentIndex = 0;
		this.updateMediaSession();
	}
	updateMediaSession() {
		if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: this.articleTitle || "Parse Article",
				artist: this.articleAuthor || "Unknown Author",
				album: "Parse Library",
				artwork: this.featuredImage ? [{
					src: this.featuredImage,
					sizes: "512x512",
					type: "image/jpeg"
				}] : []
			});
			navigator.mediaSession.playbackState = this.isPlaying ? "playing" : "paused";
			navigator.mediaSession.setActionHandler("play", () => this.play());
			navigator.mediaSession.setActionHandler("pause", () => this.pause());
			navigator.mediaSession.setActionHandler("previoustrack", () => this.prevSentence());
			navigator.mediaSession.setActionHandler("nexttrack", () => this.nextSentence());
		}
	}
	jumpToSentence(index) {
		this.clearHighlight();
		this.currentIndex = index;
		if (this.isPlaying) this.playSentence(index);
		else {
			this.highlightSentence(index);
			const el = this.sentences[index]?.elements[0];
			if (el) el.scrollIntoView({
				behavior: "smooth",
				block: "center"
			});
		}
	}
	prevSentence() {
		if (this.currentIndex > 0) this.jumpToSentence(this.currentIndex - 1);
	}
	nextSentence() {
		if (this.currentIndex < this.sentences.length - 1) this.jumpToSentence(this.currentIndex + 1);
		else this.stop();
	}
	clearHighlight() {
		if (this.currentIndex >= 0 && this.currentIndex < this.sentences.length) this.sentences[this.currentIndex].elements.forEach((el) => {
			el.classList.remove("active-sentence");
		});
	}
	highlightSentence(index) {
		if (index >= 0 && index < this.sentences.length) this.sentences[index].elements.forEach((el) => {
			el.classList.add("active-sentence");
		});
	}
	playSentence(index, shouldCancel = true) {
		if (index < 0 || index >= this.sentences.length) {
			this.stop();
			return;
		}
		this.currentIndex = index;
		this.highlightSentence(index);
		const firstEl = this.sentences[index]?.elements[0];
		if (firstEl) firstEl.scrollIntoView({
			behavior: "smooth",
			block: "center"
		});
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		this.isPlaying = true;
		this.speakSentence(index, true, shouldCancel);
	}
	speakSentence(index, withVoice, shouldCancel = true) {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		const sentence = this.sentences[index];
		if (shouldCancel) this.cancelLocalSpeech();
		const utterance = new SpeechSynthesisUtterance(sentence.text);
		this.currentUtterance = utterance;
		utterance.lang = this.contentLang;
		const voice = window.speechSynthesis.getVoices().find((v) => v.name === this.selectedVoice);
		if (voice) {
			utterance.lang = voice.lang;
			if (withVoice) utterance.voice = voice;
		}
		utterance.rate = this.selectedSpeed;
		utterance.onend = () => {
			if (this.isPlaying && this.currentIndex === index) {
				this.clearHighlight();
				this.currentIndex++;
				if (this.currentIndex < this.sentences.length) this.playSentence(this.currentIndex, false);
				else this.stop();
			}
		};
		utterance.onerror = (e) => {
			console.error("SpeechSynthesis error:", e.error, e);
			if (e.error === "interrupted" || e.error === "canceled" || !this.isPlaying) return;
			if (withVoice && this.currentIndex === index) {
				this.speakSentence(index, false);
				return;
			}
			this.stop();
		};
		if (this.isPlaying) window.speechSynthesis.speak(utterance);
	}
};
var tts = new TTSManager();
//#endregion
export { tts as t };
