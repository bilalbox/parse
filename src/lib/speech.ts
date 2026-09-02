/**
 * The seam between Narration's playback machine and the two synthesis engines
 * it drives (ADR-0005): the browser's Web Speech API in the PWA, and the
 * device's native TextToSpeech on Android.
 *
 * The seam is per-sentence, because sentence-boundary reporting is unreliable
 * in the browser engine and the per-sentence loop is what ADR-0005 commits to.
 *
 * Everything an engine does differently lives behind here — Android Chrome's
 * retry-without-a-pinned-voice, the native engine addressing voices by position.
 * Above it, the player knows voices only by name and language, and it is the one
 * place the dedupe and prefer-on-device rule is written.
 */

import type { ContentLang } from './article-content';

export interface Voice {
	name: string;
	lang: string;
}

export interface SpeakRequest {
	text: string;
	/** The voice the listener chose, by name. Backends resolve it however they address voices. */
	voiceName: string;
	/** The Article's language, used when the named voice is not installed. */
	lang: ContentLang;
	rate: number;
}

/**
 * How speaking ended. `interrupted` is a normal outcome of this design — it is
 * what stopping and skipping produce — so it is not an error. Only a genuine
 * engine failure rejects.
 */
export type SpeakOutcome = 'completed' | 'interrupted';

export interface SpeechBackend {
	listVoices(): Promise<Voice[]>;
	/** Engines that discover voices asynchronously call back when the list changes. */
	onVoicesChanged(listener: () => void): void;
	speak(request: SpeakRequest): Promise<SpeakOutcome>;
	stop(): Promise<void>;
	/**
	 * Playback is starting or ending. Android holds an OS background task across a
	 * session so the WebView's JS is not frozen mid-Article; the browser needs
	 * nothing. Optional so the core seam stays speak/stop/voices.
	 */
	beginSession?(): Promise<void>;
	endSession?(): Promise<void>;
}

/** For a runtime with no engine at all — server-side rendering, mainly. */
export function createSilentSpeechBackend(): SpeechBackend {
	return {
		async listVoices() {
			return [];
		},
		onVoicesChanged() {},
		async speak() {
			return 'interrupted';
		},
		async stop() {}
	};
}
