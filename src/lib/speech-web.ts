import type { SpeakOutcome, SpeakRequest, SpeechBackend, Voice } from './speech';

/** The part of `window` this backend uses, named so a test can stand in for it. */
export interface WebSpeechHost {
	speechSynthesis: SpeechSynthesis;
	SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance;
}

/**
 * Narration over the browser's Web Speech API (ADR-0001).
 *
 * The one engine quirk it absorbs: Android Chrome rejects some voices when they
 * are pinned onto the utterance and then produces no audio at all, so a failure
 * on a pinned voice is retried once letting the engine pick. Above the seam,
 * that retry is invisible.
 */
export function createWebSpeechBackend(host: WebSpeechHost): SpeechBackend {
	// The utterance currently in flight, and how to settle its caller's promise.
	let active: { utterance: SpeechSynthesisUtterance; settle: (outcome: SpeakOutcome) => void } | null = null;

	function cancelActive(): void {
		const current = active;
		active = null;
		if (current) {
			current.utterance.onend = null;
			current.utterance.onerror = null;
		}
		host.speechSynthesis.cancel();
		current?.settle('interrupted');
	}

	return {
		async listVoices(): Promise<Voice[]> {
			return host.speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang }));
		},

		onVoicesChanged(listener: () => void): void {
			// The list is empty on first call in most browsers and fills in later.
			host.speechSynthesis.onvoiceschanged = () => listener();
		},

		speak(request: SpeakRequest): Promise<SpeakOutcome> {
			cancelActive();

			return new Promise<SpeakOutcome>((resolve, reject) => {
				const attempt = (pinVoice: boolean) => {
					const utterance = new host.SpeechSynthesisUtterance(request.text);
					utterance.lang = request.lang;
					utterance.rate = request.rate;

					const voice = host.speechSynthesis.getVoices().find((v) => v.name === request.voiceName);
					if (voice) {
						utterance.lang = voice.lang;
						if (pinVoice) utterance.voice = voice;
					}

					const settle = (outcome: SpeakOutcome) => {
						if (active?.utterance === utterance) active = null;
						resolve(outcome);
					};

					utterance.onend = () => settle('completed');
					utterance.onerror = (e) => {
						const error = (e as SpeechSynthesisErrorEvent).error;
						// Cancelling is how stopping and skipping reach the engine, not a failure.
						if (error === 'interrupted' || error === 'canceled') {
							settle('interrupted');
							return;
						}
						if (pinVoice && voice) {
							attempt(false);
							return;
						}
						if (active?.utterance === utterance) active = null;
						reject(new Error(`Web Speech synthesis failed: ${error}`));
					};

					active = { utterance, settle };
					host.speechSynthesis.speak(utterance);
				};

				attempt(true);
			});
		},

		async stop(): Promise<void> {
			cancelActive();
		}
	};
}
