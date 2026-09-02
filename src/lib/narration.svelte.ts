import { FEATURED_IMAGE_SELECTOR } from './rescue';
import { ACTIVE_SENTENCE_CLASS, segmentContainer, type ContentLang, type Sentence } from './segmentation';
import { settings } from './settings.svelte';
import type { SpeakOutcome, SpeechBackend, Voice } from './speech';

export type { Sentence };

/** Everything the player needs to know about an Article to narrate it. */
export interface NarratedArticle {
	id: string;
	title: string;
	author: string;
	/** Decided by the Article content envelope, before the content mounts. */
	lang: ContentLang;
}

export interface NarrationOptions {
	/**
	 * When to run the segmentation pass. Deferring it a frame keeps the DOM
	 * rewrite off the Article's path to first paint — a link-dense newsletter
	 * used to freeze the tab on load.
	 */
	schedule?: (task: () => void) => void;
}

function defaultSchedule(task: () => void): void {
	if (typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(task);
	} else {
		task();
	}
}

/**
 * Narration's playback machine: it owns the sentence queue, what plays next, the
 * highlight, and where a scrub lands. It talks to exactly one synthesis engine —
 * whichever one it was handed — and knows voices only by name and language.
 *
 * Everything platform-specific is behind the SpeechBackend seam, which is why
 * this class can be driven in the test suite with a fake engine and no browser.
 */
export class NarrationPlayer {
	sentences = $state<Sentence[]>([]);
	currentIndex = $state(-1);
	isPlaying = $state(false);
	selectedVoice = $state('');
	hasVoice = $state(false);
	articleId = $state<string | null>(null);
	articleTitle = $state('');
	articleAuthor = $state('');
	featuredImage = $state('');
	contentLang = $state<ContentLang>('en');
	visible = $state(false);

	private allVoices = $state<Voice[]>([]);
	private readonly schedule: (task: () => void) => void;
	// Identifies the utterance the player is currently waiting on, so a stale
	// resolution cannot advance a queue that has since moved on.
	private speakToken = 0;
	// Whether the backend is holding a playback session on our behalf, so we
	// never ask it to release one we never took.
	private sessionHeld = false;

	constructor(
		private readonly backend: SpeechBackend,
		{ schedule = defaultSchedule }: NarrationOptions = {}
	) {
		this.schedule = schedule;
		this.backend.onVoicesChanged(() => void this.refreshVoices());
		void this.refreshVoices();
	}

	/** The listening pace, held by the settings store like every other preference. */
	get selectedSpeed(): number {
		return settings.narrationSpeed;
	}

	private async refreshVoices(): Promise<void> {
		try {
			this.applyVoiceList(await this.backend.listVoices());
		} catch (e) {
			console.error('Narration could not list voices:', e);
		}
	}

	/**
	 * Dedupe to one voice per locale (preferring on-device over network) and
	 * select one. The rule is identical for both engines, so it lives here rather
	 * than being written once per backend.
	 */
	private applyVoiceList(voices: Voice[]): void {
		const supported = voices.filter((v) => v.lang && /^(en|ar)/i.test(v.lang));

		const byLocale = new Map<string, Voice>();
		for (const v of supported) {
			const locale = v.lang.toLowerCase();
			const isNetwork = /network/i.test(v.name);
			const existing = byLocale.get(locale);
			if (!existing || (/network/i.test(existing.name) && !isNetwork)) {
				byLocale.set(locale, v);
			}
		}

		this.allVoices = [...byLocale.values()].sort((a, b) => a.lang.localeCompare(b.lang));
		this.resolveVoice();
	}

	getUsableVoices(): Voice[] {
		return this.allVoices.filter((v) => v.lang.toLowerCase().startsWith(this.contentLang));
	}

	/** Pick the active voice for the current content language, honouring the saved preference. */
	private resolveVoice(): void {
		const usable = this.getUsableVoices();
		this.hasVoice = usable.length > 0;

		const stored = settings.narrationVoice(this.contentLang);
		if (stored && usable.some((v) => v.name === stored)) {
			this.selectedVoice = stored;
		} else {
			this.selectedVoice = usable[0]?.name ?? '';
		}
	}

	setSpeed(speed: number): void {
		settings.setNarrationSpeed(speed);
		if (this.isPlaying) this.playSentence(this.currentIndex);
	}

	setVoice(voiceName: string): void {
		this.selectedVoice = voiceName;
		settings.setNarrationVoice(this.contentLang, voiceName);
		if (this.isPlaying) this.playSentence(this.currentIndex);
	}

	loadArticle(article: NarratedArticle, container: Element): void {
		// Stop current playback if loading a new article
		if (this.articleId !== article.id) {
			this.stop();
		}

		this.articleId = article.id;
		this.articleTitle = article.title;
		this.articleAuthor = article.author;

		const img = container.querySelector(FEATURED_IMAGE_SELECTOR);
		this.featuredImage = img?.getAttribute('src') || '';

		// The language decides the segmenter locale and which voices are usable.
		this.contentLang = article.lang;
		this.resolveVoice();
		this.updateMediaSession();

		// Only playback and click-to-jump need the sentence spans, not display, so
		// the rewrite waits until after the Article has painted.
		this.schedule(() => {
			if (this.articleId !== article.id) return;

			this.sentences = segmentContainer(container, this.contentLang);

			// If we're already playing this article, re-highlight and restore progress
			if (this.isPlaying && this.articleId === article.id) {
				this.highlightSentence(this.currentIndex);
			} else {
				this.currentIndex = 0;
			}
		});
	}

	showPlayer(): void {
		this.visible = true;
	}

	hidePlayer(): void {
		this.stop();
		this.visible = false;
	}

	togglePlay(): void {
		if (this.isPlaying) {
			this.pause();
		} else {
			this.play();
		}
	}

	play(): void {
		if (this.sentences.length === 0) return;
		this.isPlaying = true;
		this.visible = true;
		if (!this.sessionHeld) {
			this.sessionHeld = true;
			void this.backend.beginSession?.();
		}
		this.updateMediaSession();
		this.playSentence(this.currentIndex);
	}

	pause(): void {
		this.isPlaying = false;
		this.endUtterance();
		this.updateMediaSession();
	}

	stop(): void {
		this.isPlaying = false;
		this.endUtterance();
		this.clearHighlight();
		this.currentIndex = 0;
		this.updateMediaSession();
	}

	/** Abandon whatever is being spoken and let the engine go quiet. */
	private endUtterance(): void {
		this.speakToken++;
		void this.backend.stop();
		if (this.sessionHeld) {
			this.sessionHeld = false;
			void this.backend.endSession?.();
		}
	}

	updateMediaSession(): void {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

		navigator.mediaSession.metadata = new MediaMetadata({
			title: this.articleTitle || 'Parse Article',
			artist: this.articleAuthor || 'Unknown Author',
			album: 'Parse Library',
			artwork: this.featuredImage
				? [{ src: this.featuredImage, sizes: '512x512', type: 'image/jpeg' }]
				: []
		});
		navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
		navigator.mediaSession.setActionHandler('play', () => this.play());
		navigator.mediaSession.setActionHandler('pause', () => this.pause());
		navigator.mediaSession.setActionHandler('previoustrack', () => this.prevSentence());
		navigator.mediaSession.setActionHandler('nexttrack', () => this.nextSentence());
	}

	/**
	 * Where a scrub lands. The arithmetic belongs to the player, which knows how
	 * long the queue is; the scrubber only knows how far along it was clicked.
	 */
	seekToFraction(fraction: number): void {
		if (this.sentences.length === 0) return;
		const target = Math.floor(fraction * this.sentences.length);
		this.jumpToSentence(Math.max(0, Math.min(target, this.sentences.length - 1)));
	}

	/** How far through the queue playback is, as a fraction, for the scrubber. */
	get progress(): number {
		return this.sentences.length > 0 ? this.currentIndex / this.sentences.length : 0;
	}

	jumpToSentence(index: number): void {
		this.clearHighlight();
		this.currentIndex = index;
		if (this.isPlaying) {
			this.playSentence(index);
		} else {
			this.highlightSentence(index);
			scrollTo(this.sentences[index]?.elements[0]);
		}
	}

	prevSentence(): void {
		if (this.currentIndex > 0) {
			this.jumpToSentence(this.currentIndex - 1);
		}
	}

	nextSentence(): void {
		if (this.currentIndex < this.sentences.length - 1) {
			this.jumpToSentence(this.currentIndex + 1);
		} else {
			this.stop();
		}
	}

	clearHighlight(): void {
		this.sentences[this.currentIndex]?.elements.forEach((el) => {
			el.classList.remove(ACTIVE_SENTENCE_CLASS);
		});
	}

	highlightSentence(index: number): void {
		this.sentences[index]?.elements.forEach((el) => {
			el.classList.add(ACTIVE_SENTENCE_CLASS);
		});
	}

	playSentence(index: number): void {
		const sentence = this.sentences[index];
		if (!sentence) {
			this.stop();
			return;
		}

		this.currentIndex = index;
		this.highlightSentence(index);
		scrollTo(sentence.elements[0]);

		this.isPlaying = true;
		const token = ++this.speakToken;

		this.backend
			.speak({
				text: sentence.text,
				voiceName: this.selectedVoice,
				lang: this.contentLang,
				rate: this.selectedSpeed
			})
			.then((outcome: SpeakOutcome) => {
				// Stopping and skipping both interrupt; neither should advance the
				// queue, and neither is an error.
				if (outcome === 'interrupted' || token !== this.speakToken) return;
				this.advanceAfter(index);
			})
			.catch((e: unknown) => {
				if (token !== this.speakToken) return;
				console.error('Narration engine failed:', e);
				this.stop();
			});
	}

	/** Advance to the next sentence (or stop) once the current one finishes. */
	private advanceAfter(index: number): void {
		if (!this.isPlaying || this.currentIndex !== index) return;

		this.clearHighlight();
		this.currentIndex++;
		if (this.currentIndex < this.sentences.length) {
			this.playSentence(this.currentIndex);
		} else {
			this.stop();
		}
	}
}

/** Follow-along scrolling, skipped in runtimes whose elements cannot scroll (tests). */
function scrollTo(el: Element | undefined): void {
	if (typeof el?.scrollIntoView === 'function') {
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
}
