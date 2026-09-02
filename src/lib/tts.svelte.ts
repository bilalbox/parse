import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { App } from '@capacitor/app';

export interface Sentence {
	text: string;
	elements: HTMLElement[];
}

type ContentLang = 'ar' | 'en';

// Conservative list: titles/abbreviations that end in "." but almost never end a
// sentence (they're followed by a name/number). Kept small to avoid false merges.
const ABBREVIATIONS = new Set([
	'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'e.g', 'i.e', 'u.s'
]);

/** True if a chunk ends with a single-period abbreviation or an initial (e.g. "Mr.", "J."). */
function endsWithAbbreviation(chunk: string): boolean {
	const trimmed = chunk.trimEnd();
	// Must end in exactly one period whose preceding char is not itself a terminator
	// (rules out "...", "?." and other multi-terminator runs).
	if (!/[^.!?]\.$/.test(trimmed)) return false;
	const word = trimmed.match(/(\S+)\.$/)?.[1] ?? '';
	return /^[A-Z]$/.test(word) || ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * Locale-aware sentence segmentation via the platform ICU segmenter.
 * Returns contiguous, literal slices of `text` (they tile it exactly).
 */
function segmentSentences(text: string, locale: ContentLang): string[] {
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
		return [...segmenter.segment(text)].map((s) => s.segment);
	}
	// Fallback for environments without Intl.Segmenter: a boundary is terminal
	// punctuation followed by whitespace or end-of-text (Arabic adds \u061F, \u06D4).
	const terminators = locale === 'ar' ? '.!?\\u061F\\u06D4' : '.!?';
	return text.match(new RegExp(`[\\s\\S]*?[${terminators}]+(?:\\s+|$)|[\\s\\S]+$`, 'g')) || [];
}

class TTSManager {
	sentences = $state<Sentence[]>([]);
	currentIndex = $state(-1);
	isPlaying = $state(false);
	selectedVoice = $state('');
	selectedSpeed = $state(1.0);
	hasVoice = $state(false);
	articleId = $state<string | null>(null);
	articleTitle = $state('');
	articleAuthor = $state('');
	featuredImage = $state('');
	isArabicContent = $state(false);
	visible = $state(false);

	private currentUtterance: SpeechSynthesisUtterance | null = null;
	private allVoices = $state<SpeechSynthesisVoice[]>([]);
	// Raw voice list from the native plugin, kept in plugin order so we can map a
	// selected voice name back to the index `TextToSpeech.speak({ voice })` expects.
	private nativeVoices: { name: string; lang: string }[] = [];
	private backgroundTaskId: string | null = null;

	constructor() {
		if (typeof window === 'undefined') return;

		const storedSpeed = localStorage.getItem('tts_speed');
		if (storedSpeed) this.selectedSpeed = parseFloat(storedSpeed);

		if (this.isNative) {
			// Android System WebView ships no speechSynthesis engine; bridge to the
			// platform's native TextToSpeech via the Capacitor plugin instead.
			this.initNativeVoices();
		} else if ('speechSynthesis' in window) {
			window.speechSynthesis.onvoiceschanged = () => {
				this.initVoices();
			};
			this.initVoices();
		}
	}

	private get isNative(): boolean {
		return Capacitor.isNativePlatform();
	}

	private get contentLang(): ContentLang {
		return this.isArabicContent ? 'ar' : 'en';
	}

	/** Dedupe to one voice per locale (preferring on-device over network) and select one. */
	private applyVoiceList(voices: { name: string; lang: string }[]) {
		const supported = voices.filter(v => v.lang && /^(en|ar)/i.test(v.lang));

		// Keep one voice per locale, preferring on-device voices over network ones.
		const byLocale = new Map<string, { name: string; lang: string }>();
		for (const v of supported) {
			const locale = v.lang.toLowerCase();
			const isNetwork = /network/i.test(v.name);
			const existing = byLocale.get(locale);
			if (!existing || (/network/i.test(existing.name) && !isNetwork)) {
				byLocale.set(locale, v);
			}
		}

		this.allVoices = [...byLocale.values()].sort((a, b) =>
			a.lang.localeCompare(b.lang)
		) as SpeechSynthesisVoice[];
		this.resolveVoice();
	}

	initVoices() {
		if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
		this.applyVoiceList(window.speechSynthesis.getVoices());
	}

	private async initNativeVoices() {
		try {
			const { voices } = await TextToSpeech.getSupportedVoices();
			this.nativeVoices = voices;
			this.applyVoiceList(voices);
		} catch (e) {
			console.error('Native TTS getSupportedVoices failed:', e);
		}
	}

	getUsableVoices() {
		return this.allVoices.filter(v => v.lang.toLowerCase().startsWith(this.contentLang));
	}

	/** Pick the active voice for the current content language, honouring the saved preference. */
	private resolveVoice() {
		const usable = this.getUsableVoices();
		this.hasVoice = usable.length > 0;

		const stored = localStorage.getItem(`tts_voice_${this.contentLang}`);
		if (stored && usable.some(v => v.name === stored)) {
			this.selectedVoice = stored;
		} else if (usable.length > 0) {
			this.selectedVoice = usable[0].name;
		} else {
			this.selectedVoice = '';
		}
	}

	setSpeed(speed: number) {
		this.selectedSpeed = speed;
		localStorage.setItem('tts_speed', speed.toString());
		if (this.isPlaying) {
			this.playSentence(this.currentIndex);
		}
	}

	setVoice(voiceName: string) {
		this.selectedVoice = voiceName;
		localStorage.setItem(`tts_voice_${this.contentLang}`, voiceName);
		if (this.isPlaying) {
			this.playSentence(this.currentIndex);
		}
	}

	cancelLocalSpeech() {
		if (this.isNative) {
			TextToSpeech.stop().catch(() => {});
			return;
		}
		if (this.currentUtterance) {
			this.currentUtterance.onend = null;
			this.currentUtterance.onerror = null;
			this.currentUtterance = null;
		}
		if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
			window.speechSynthesis.cancel();
		}
	}

	loadArticle(articleId: string, title: string, author: string, container: HTMLElement) {
		// Stop current playback if loading a new article
		if (this.articleId !== articleId) {
			this.stop();
		}

		this.articleId = articleId;
		this.articleTitle = title;
		this.articleAuthor = author;

		const img = container.querySelector('.featured-image-container img, img') as HTMLImageElement | null;
		this.featuredImage = img ? img.src : '';

		// Detect if content is Arabic, then pick a voice that matches the language.
		const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
		this.isArabicContent = arabicPattern.test(container.textContent || '') || arabicPattern.test(title || '');
		this.resolveVoice();
		this.updateMediaSession();

		// Sentence split the container in-place. Deferred a frame so the article's
		// initial paint isn't blocked by this DOM rewrite on long/link-heavy content;
		// only playback and click-to-jump need the tts-sentence spans, not display.
		requestAnimationFrame(() => {
			if (this.articleId !== articleId) return;

			this.sentences = this.prepareTtsContent(container);

			// If we're already playing this article, re-highlight and restore progress
			if (this.isPlaying && this.articleId === articleId) {
				this.highlightSentence(this.currentIndex);
			} else {
				this.currentIndex = 0;
			}
		});
	}

	/**
	 * Split a block of text into sentences using the platform's locale-aware
	 * segmenter, then re-join title/initial over-splits (e.g. "Mr.", "J.") for
	 * English. Returns literal, contiguous slices of `text` (span-mapper relies on it).
	 */
	private splitIntoSentences(text: string): string[] {
		const chunks = segmentSentences(text, this.contentLang);
		return this.contentLang === 'ar' ? chunks : this.mergeAbbreviations(chunks);
	}

	/** Re-join chunks split at a title or initial, e.g. "Mr." + "Smith said hi." */
	private mergeAbbreviations(chunks: string[]): string[] {
		const merged: string[] = [];
		for (const chunk of chunks) {
			const prev = merged[merged.length - 1];
			if (prev !== undefined && endsWithAbbreviation(prev)) {
				merged[merged.length - 1] = prev + chunk;
			} else {
				merged.push(chunk);
			}
		}
		return merged;
	}

	/** Undo a previous pass so re-preparing a container re-splits its text instead of its spans. */
	private unwrapSentenceSpans(container: HTMLElement) {
		// Splitting works off text-node offsets, so the shards left behind by the
		// removed spans have to be merged back into whole runs. Only the blocks that
		// held spans need it — normalizing the whole container would reach into
		// Svelte-managed regions (the summary callout) for nothing.
		const parents = new Set<Element>();
		container.querySelectorAll('span.tts-sentence').forEach(span => {
			const parent = span.parentElement;
			if (parent) parents.add(parent);
			span.replaceWith(...span.childNodes);
		});
		parents.forEach(parent => parent.normalize());
	}

	private prepareTtsContent(container: HTMLElement): Sentence[] {
		const sentences: Sentence[] = [];
		let sentenceCount = 0;

		// The attachment that drives loadArticle re-runs on the same container —
		// twice during the initial mount alone — so this may be a second pass over
		// content the first pass already wrapped.
		this.unwrapSentenceSpans(container);

		const blockSelector = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, summary';
		const skipSelector = '.parsed-action-links, .parsed-rescued-images';

		const blocks = Array.from(container.querySelectorAll(blockSelector))
			.filter(el => !el.closest(skipSelector));

		blocks.forEach(block => {
			// A block's own text is only what no *nearer* block claims. Blocks nest
			// (blockquote > p, li > ul > li), so without this a quote was segmented
			// twice — once by the blockquote, once by its paragraph — and therefore
			// queued twice and read aloud twice.
			const textNodesInBlock: Text[] = [];
			const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
			let node: Node | null;
			while ((node = walk.nextNode())) {
				if ((node as Text).parentElement?.closest(blockSelector) !== block) continue;
				textNodesInBlock.push(node as Text);
			}

			// Must be the claimed nodes, not block.textContent: the offsets below
			// index into this string.
			const blockText = textNodesInBlock.map(n => n.data).join('');
			// A container block (a blockquote wrapping paragraphs) is left holding
			// only inter-tag whitespace; queueing that as a sentence would put a
			// silent entry in the playback order.
			if (!blockText.trim()) return;

			const blockSentences = this.splitIntoSentences(blockText);
			if (blockSentences.length === 0) return;

			// Locate each sentence's span in blockText once per block. This used to
			// re-scan from scratch for every text node (O(text nodes * sentences)),
			// which freezes the tab on link/formatting-heavy content (lots of small
			// text nodes per block, e.g. newsletters).
			// splitIntoSentences guarantees literal, contiguous slices of blockText,
			// so each sentence's start is exactly where the previous one ended.
			const sentenceBounds: { start: number; end: number }[] = [];
			let sentenceCursor = 0;
			for (const sText of blockSentences) {
				const end = sentenceCursor + sText.length;
				sentenceBounds.push({ start: sentenceCursor, end });
				sentenceCursor = end;
			}

			let textNodesOffset = 0;
			let sentenceIdx = 0;
			textNodesInBlock.forEach(node => {
				const parent = node.parentElement;
				const nodeStart = textNodesOffset;
				const nodeLength = node.length;
				textNodesOffset += nodeLength;
				if (!parent) return;

				const nodeText = node.textContent || '';
				const fragment = document.createDocumentFragment();
				let nodeOffset = 0;

				while (nodeOffset < nodeLength) {
					const absOffset = nodeStart + nodeOffset;
					while (sentenceIdx < sentenceBounds.length && sentenceBounds[sentenceIdx].end <= absOffset) {
						sentenceIdx++;
					}
					if (sentenceIdx >= sentenceBounds.length) {
						fragment.appendChild(document.createTextNode(nodeText.substring(nodeOffset)));
						break;
					}

					const { start: sStart, end: sEnd } = sentenceBounds[sentenceIdx];

					if (absOffset < sStart) {
						const len = Math.min(sStart - absOffset, nodeLength - nodeOffset);
						fragment.appendChild(document.createTextNode(nodeText.substring(nodeOffset, nodeOffset + len)));
						nodeOffset += len;
					} else {
						const len = Math.min(sEnd - absOffset, nodeLength - nodeOffset);
						const matchText = nodeText.substring(nodeOffset, nodeOffset + len);

						const span = document.createElement('span');
						span.className = 'tts-sentence';
						const globalIdx = sentenceCount + sentenceIdx;
						span.dataset.sentenceIndex = globalIdx.toString();
						span.textContent = matchText;
						fragment.appendChild(span);

						if (!sentences[globalIdx]) {
							sentences[globalIdx] = {
								text: blockSentences[sentenceIdx],
								elements: []
							};
						}
						sentences[globalIdx].elements.push(span);

						nodeOffset += len;
					}
				}

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
		if (this.isPlaying) {
			this.pause();
		} else {
			this.play();
		}
	}

	play() {
		if (this.sentences.length === 0) return;
		this.isPlaying = true;
		this.visible = true;
		this.acquireBackgroundTask();
		this.updateMediaSession();
		this.playSentence(this.currentIndex);
	}

	pause() {
		this.isPlaying = false;
		this.cancelLocalSpeech();
		this.releaseBackgroundTask();
		this.updateMediaSession();
	}

	stop() {
		this.isPlaying = false;
		this.cancelLocalSpeech();
		this.clearHighlight();
		this.currentIndex = 0;
		this.releaseBackgroundTask();
		this.updateMediaSession();
	}

	private async acquireBackgroundTask() {
		if (!this.isNative) return;
		if (this.backgroundTaskId) return;

		this.backgroundTaskId = await BackgroundTask.beforeExit(async () => {
			// Note: OS may kill this if it runs too long without a foreground service
		});
	}

	private async releaseBackgroundTask() {
		if (!this.isNative) return;
		if (this.backgroundTaskId) {
			await BackgroundTask.finish({ taskId: this.backgroundTaskId });
			this.backgroundTaskId = null;
		}
	}

	updateMediaSession() {
		if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: this.articleTitle || 'Parse Article',
				artist: this.articleAuthor || 'Unknown Author',
				album: 'Parse Library',
				artwork: this.featuredImage ? [{ src: this.featuredImage, sizes: '512x512', type: 'image/jpeg' }] : []
			});
			navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
			navigator.mediaSession.setActionHandler('play', () => this.play());
			navigator.mediaSession.setActionHandler('pause', () => this.pause());
			navigator.mediaSession.setActionHandler('previoustrack', () => this.prevSentence());
			navigator.mediaSession.setActionHandler('nexttrack', () => this.nextSentence());
		}
	}

	jumpToSentence(index: number) {
		this.clearHighlight();
		this.currentIndex = index;
		if (this.isPlaying) {
			this.playSentence(index);
		} else {
			this.highlightSentence(index);
			const el = this.sentences[index]?.elements[0];
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	prevSentence() {
		if (this.currentIndex > 0) {
			this.jumpToSentence(this.currentIndex - 1);
		}
	}

	nextSentence() {
		if (this.currentIndex < this.sentences.length - 1) {
			this.jumpToSentence(this.currentIndex + 1);
		} else {
			this.stop();
		}
	}

	clearHighlight() {
		if (this.currentIndex >= 0 && this.currentIndex < this.sentences.length) {
			this.sentences[this.currentIndex].elements.forEach(el => {
				el.classList.remove('active-sentence');
			});
		}
	}

	highlightSentence(index: number) {
		if (index >= 0 && index < this.sentences.length) {
			this.sentences[index].elements.forEach(el => {
				el.classList.add('active-sentence');
			});
		}
	}

	playSentence(index: number, shouldCancel: boolean = true) {
		if (index < 0 || index >= this.sentences.length) {
			this.stop();
			return;
		}

		this.currentIndex = index;
		this.highlightSentence(index);

		const firstEl = this.sentences[index]?.elements[0];
		if (firstEl) {
			firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}

		if (typeof window === 'undefined') return;
		if (!this.isNative && !('speechSynthesis' in window)) return;

		this.isPlaying = true;
		if (this.isNative) {
			this.speakSentenceNative(index);
		} else {
			this.speakSentence(index, true, shouldCancel);
		}
	}

	/** Advance to the next sentence (or stop) once the current one finishes. */
	private advanceAfter(index: number) {
		if (this.isPlaying && this.currentIndex === index) {
			this.clearHighlight();
			this.currentIndex++;
			if (this.currentIndex < this.sentences.length) {
				this.playSentence(this.currentIndex, false);
			} else {
				this.stop();
			}
		}
	}

	private async speakSentenceNative(index: number) {
		const sentence = this.sentences[index];
		if (!sentence) {
			this.stop();
			return;
		}

		const selected = this.nativeVoices.find(v => v.name === this.selectedVoice);
		const voiceIndex = selected ? this.nativeVoices.indexOf(selected) : -1;
		const lang = selected?.lang || (this.contentLang === 'ar' ? 'ar' : 'en-US');

		try {
			await TextToSpeech.stop();
			// Bail if playback was paused/changed while we were stopping.
			if (!this.isPlaying || this.currentIndex !== index) return;

			await TextToSpeech.speak({
				text: sentence.text,
				lang,
				rate: this.selectedSpeed,
				...(voiceIndex >= 0 ? { voice: voiceIndex } : {})
			});

			// speak() resolves when the utterance finishes playing.
			this.advanceAfter(index);
		} catch (e) {
			// stop() interrupting an in-flight utterance rejects here; ignore unless
			// this is still the active sentence (a genuine engine error).
			if (!this.isPlaying || this.currentIndex !== index) return;
			console.error('Native TTS error:', e);
			this.stop();
		}
	}

	private speakSentence(index: number, withVoice: boolean, shouldCancel: boolean = true) {
		if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

		const sentence = this.sentences[index];
		if (shouldCancel) {
			this.cancelLocalSpeech();
		}

		const utterance = new SpeechSynthesisUtterance(sentence.text);
		this.currentUtterance = utterance;

		// Default to content language (en or ar)
		utterance.lang = this.contentLang;

		const voice = window.speechSynthesis.getVoices().find(v => v.name === this.selectedVoice);
		if (voice) {
			utterance.lang = voice.lang;
			if (withVoice) utterance.voice = voice;
		}
		utterance.rate = this.selectedSpeed;

		utterance.onend = () => {
			this.advanceAfter(index);
		};

		utterance.onerror = (e) => {
			console.error('SpeechSynthesis error:', e.error, e);
			if (e.error === 'interrupted' || e.error === 'canceled' || !this.isPlaying) return;

			if (withVoice && this.currentIndex === index) {
				// Retry once without pinning exact voice (Android Chrome issue)
				this.speakSentence(index, false);
				return;
			}
			this.stop();
		};

		if (this.isPlaying) {
			window.speechSynthesis.speak(utterance);
		}
	}
}

export const tts = new TTSManager();
