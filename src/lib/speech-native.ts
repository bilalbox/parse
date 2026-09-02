import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import type { SpeakOutcome, SpeakRequest, SpeechBackend, Voice } from './speech';

/**
 * Narration over the device's native TextToSpeech engine on Android, where the
 * System WebView ships no `speechSynthesis` (ADR-0005).
 *
 * Two things live only here. The engine addresses voices by their position in
 * the list it returned, so the mapping from the name the player holds back to
 * that index is this module's business. And `TextToSpeech.speak` rejects when
 * something else stops it, which is indistinguishable from a real failure at the
 * plugin's edge — so this counts its own cancellations rather than asking the
 * player what it meant.
 */
export function createNativeSpeechBackend(): SpeechBackend {
	// Kept in plugin order: the index is the engine's voice address.
	let voices: Voice[] = [];
	// Bumped by every cancellation. An utterance whose generation is stale was
	// stopped by us; anything else that rejects is a genuine engine failure.
	let generation = 0;
	let backgroundTaskId: string | null = null;

	async function cancel(): Promise<void> {
		generation++;
		await TextToSpeech.stop().catch(() => {});
	}

	return {
		async listVoices(): Promise<Voice[]> {
			const { voices: supported } = await TextToSpeech.getSupportedVoices();
			voices = supported.map((v) => ({ name: v.name, lang: v.lang }));
			return voices;
		},

		// The native list is fixed for the life of the session.
		onVoicesChanged() {},

		async speak(request: SpeakRequest): Promise<SpeakOutcome> {
			await cancel();
			const mine = generation;

			const voiceIndex = voices.findIndex((v) => v.name === request.voiceName);
			const lang = voices[voiceIndex]?.lang || (request.lang === 'ar' ? 'ar' : 'en-US');

			try {
				// speak() resolves when the utterance finishes playing.
				await TextToSpeech.speak({
					text: request.text,
					lang,
					rate: request.rate,
					...(voiceIndex >= 0 ? { voice: voiceIndex } : {})
				});
				return mine === generation ? 'completed' : 'interrupted';
			} catch (e) {
				if (mine !== generation) return 'interrupted';
				throw e;
			}
		},

		async stop(): Promise<void> {
			await cancel();
		},

		async beginSession(): Promise<void> {
			if (backgroundTaskId) return;
			backgroundTaskId = await BackgroundTask.beforeExit(async () => {
				// Note: OS may kill this if it runs too long without a foreground service
			});
		},

		async endSession(): Promise<void> {
			if (!backgroundTaskId) return;
			await BackgroundTask.finish({ taskId: backgroundTaskId });
			backgroundTaskId = null;
		}
	};
}
