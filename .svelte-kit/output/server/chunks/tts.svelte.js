import "./internal.js";
import "./settings.svelte.js";
//#region src/lib/tts.svelte.ts
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
	silentAudio = null;
	currentUtterance = null;
	voices = [];
	constructor() {
		if (typeof window !== "undefined") {
			this.silentAudio = document.createElement("audio");
			this.silentAudio.src = "/silence.wav";
			this.silentAudio.loop = true;
			this.silentAudio.style.display = "none";
			document.body.appendChild(this.silentAudio);
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
	initVoices() {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		const english = window.speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
		const byLocale = /* @__PURE__ */ new Map();
		for (const v of english) {
			const locale = v.lang.toLowerCase();
			const isNetwork = /network/i.test(v.name);
			const existing = byLocale.get(locale);
			if (!existing || /network/i.test(existing.name) && !isNetwork) byLocale.set(locale, v);
		}
		this.voices = [...byLocale.values()].sort((a, b) => a.lang.localeCompare(b.lang));
		this.hasVoice = this.voices.length > 0;
		const stored = localStorage.getItem("tts_voice");
		if (stored && this.voices.some((v) => v.name === stored)) this.selectedVoice = stored;
		else if (this.voices.length > 0) {
			const pageLang = (document.documentElement.lang || "en").slice(0, 2).toLowerCase();
			const match = this.voices.find((v) => v.lang.toLowerCase().startsWith(pageLang));
			this.selectedVoice = (match || this.voices[0]).name;
		}
	}
	getUsableVoices() {
		return this.voices;
	}
	setSpeed(speed) {
		this.selectedSpeed = speed;
		localStorage.setItem("tts_speed", speed.toString());
		if (this.silentAudio) this.silentAudio.playbackRate = speed;
		this.updateMediaSessionPosition();
		if (this.isPlaying) this.playSentence(this.currentIndex);
	}
	setVoice(voiceName) {
		this.selectedVoice = voiceName;
		localStorage.setItem("tts_voice", voiceName);
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
	setupMediaSession() {
		if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: this.articleTitle,
			artist: this.articleAuthor || "Parse Reader",
			album: "Articles",
			artwork: [{
				src: this.featuredImage || "/icon.svg",
				sizes: "512x512",
				type: "image/svg+xml"
			}]
		});
		navigator.mediaSession.setActionHandler("play", () => this.play());
		navigator.mediaSession.setActionHandler("pause", () => this.pause());
		navigator.mediaSession.setActionHandler("previoustrack", () => this.prevSentence());
		navigator.mediaSession.setActionHandler("nexttrack", () => this.nextSentence());
		navigator.mediaSession.setActionHandler("seekbackward", () => this.prevSentence());
		navigator.mediaSession.setActionHandler("seekforward", () => this.nextSentence());
		try {
			navigator.mediaSession.setActionHandler("seekto", (details) => {
				if (details.seekTime !== void 0) {
					const targetIdx = Math.floor(details.seekTime);
					const clampedIdx = Math.max(0, Math.min(targetIdx, this.sentences.length - 1));
					this.jumpToSentence(clampedIdx);
				}
			});
		} catch (err) {
			console.warn("[tts] seekto handler registration failed:", err);
		}
	}
	updateMediaSessionPosition() {
		if (typeof window === "undefined" || !("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession) || this.sentences.length === 0) return;
		try {
			navigator.mediaSession.setPositionState({
				duration: this.sentences.length,
				playbackRate: this.selectedSpeed || 1,
				position: Math.max(0, Math.min(this.currentIndex, this.sentences.length))
			});
		} catch (e) {
			console.warn("[tts] Failed to set mediaSession position state:", e);
		}
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
		this.sentences = this.prepareTtsContent(container);
		if (this.isPlaying && this.articleId === articleId) this.highlightSentence(this.currentIndex);
		else this.currentIndex = 0;
		this.updateProgress();
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
			const blockSentences = blockText.match(/[^.!?\s][^.!?]*(?:[.!?]+(?!\s*[a-z]|$)[^.!?]*)*[.!?]*/g) || [];
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
		if (this.sentences.length === 0 || !this.hasVoice) return;
		this.isPlaying = true;
		this.visible = true;
		this.setupMediaSession();
		if (this.silentAudio) this.silentAudio.play().catch((err) => {
			console.warn("[tts] silentAudio play failed:", err);
		});
		this.playSentence(this.currentIndex);
	}
	pause() {
		this.isPlaying = false;
		this.cancelLocalSpeech();
		if (typeof window !== "undefined" && "mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
		if (this.silentAudio) this.silentAudio.pause();
	}
	stop() {
		this.isPlaying = false;
		this.cancelLocalSpeech();
		this.clearHighlight();
		this.currentIndex = 0;
		this.updateProgress();
		if (typeof window !== "undefined" && "mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
		if (this.silentAudio) {
			this.silentAudio.pause();
			this.silentAudio.currentTime = 0;
		}
	}
	jumpToSentence(index) {
		this.clearHighlight();
		this.currentIndex = index;
		this.updateProgress();
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
	updateProgress() {}
	playSentence(index) {
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
		this.updateMediaSessionPosition();
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		this.isPlaying = true;
		if (typeof window !== "undefined" && "mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
		this.speakSentence(index, true);
	}
	speakSentence(index, withVoice) {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		const sentence = this.sentences[index];
		this.cancelLocalSpeech();
		const utterance = new SpeechSynthesisUtterance(sentence.text);
		this.currentUtterance = utterance;
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
				if (this.currentIndex < this.sentences.length) this.playSentence(this.currentIndex);
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
		setTimeout(() => {
			if (this.isPlaying && this.currentUtterance === utterance) window.speechSynthesis.speak(utterance);
		}, 0);
	}
};
var tts = new TTSManager();
//#endregion
export { tts as t };
