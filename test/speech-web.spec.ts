import { describe, it, expect } from 'vitest';
import { createWebSpeechBackend, type WebSpeechHost } from '../src/lib/speech-web';

/**
 * A stand-in for `window.speechSynthesis`. The engine quirks the adapter exists
 * to absorb — Android Chrome refusing a pinned voice, cancellation surfacing as
 * an error event — are only reachable by driving the events ourselves.
 */
function stubHost(voices = [{ name: 'Alice', lang: 'en-US' }]) {
	const utterances: any[] = [];
	let cancelled = 0;

	class StubUtterance {
		lang = '';
		rate = 1;
		voice: any = null;
		onend: (() => void) | null = null;
		onerror: ((e: { error: string }) => void) | null = null;
		constructor(public text: string) {}
	}

	const host = {
		speechSynthesis: {
			getVoices: () => voices,
			speak: (u: any) => utterances.push(u),
			cancel: () => {
				cancelled++;
			},
			set onvoiceschanged(_fn: unknown) {}
		},
		SpeechSynthesisUtterance: StubUtterance
	} as unknown as WebSpeechHost;

	return {
		host,
		utterances,
		get cancelled() {
			return cancelled;
		},
		get live() {
			return utterances[utterances.length - 1];
		}
	};
}

describe('the Web Speech backend', () => {
	it('offers the engine voices by name and language', async () => {
		const stub = stubHost([{ name: 'Alice', lang: 'en-US' }]);

		expect(await createWebSpeechBackend(stub.host).listVoices()).toEqual([
			{ name: 'Alice', lang: 'en-US' }
		]);
	});

	it('speaks with the requested voice, language and rate', async () => {
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		void backend.speak({ text: 'Hello there.', voiceName: 'Alice', lang: 'en', rate: 1.5 });

		expect(stub.live.text).toBe('Hello there.');
		expect(stub.live.rate).toBe(1.5);
		expect(stub.live.voice).toMatchObject({ name: 'Alice' });
		// The engine's own locale beats the bare content language.
		expect(stub.live.lang).toBe('en-US');
	});

	it('resolves as completed when the utterance ends', async () => {
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		const spoken = backend.speak({ text: 'Hello.', voiceName: 'Alice', lang: 'en', rate: 1 });
		stub.live.onend!();

		expect(await spoken).toBe('completed');
	});

	it('resolves as interrupted when stopped, rather than rejecting', async () => {
		// Interruption is what stopping and skipping produce. Modelling it as an
		// error is why the player used to re-derive intent from playback state.
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		const spoken = backend.speak({ text: 'Hello.', voiceName: 'Alice', lang: 'en', rate: 1 });
		await backend.stop();

		expect(await spoken).toBe('interrupted');
		expect(stub.cancelled).toBeGreaterThan(0);
	});

	it('resolves as interrupted when the engine reports a cancellation', async () => {
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		const spoken = backend.speak({ text: 'Hello.', voiceName: 'Alice', lang: 'en', rate: 1 });
		stub.live.onerror!({ error: 'interrupted' });

		expect(await spoken).toBe('interrupted');
	});

	it('retries without pinning the voice when the engine refuses it', async () => {
		// Android Chrome rejects some pinned voices and then produces no audio at
		// all; letting the engine pick is the difference between narration and
		// silence.
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		const spoken = backend.speak({ text: 'Hello.', voiceName: 'Alice', lang: 'en', rate: 1 });
		stub.live.onerror!({ error: 'voice-unavailable' });

		expect(stub.utterances).toHaveLength(2);
		expect(stub.live.voice).toBe(null);
		expect(stub.live.lang).toBe('en-US');

		stub.live.onend!();
		expect(await spoken).toBe('completed');
	});

	it('rejects when the retry fails too', async () => {
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		const spoken = backend.speak({ text: 'Hello.', voiceName: 'Alice', lang: 'en', rate: 1 });
		stub.live.onerror!({ error: 'synthesis-failed' });
		stub.live.onerror!({ error: 'synthesis-failed' });

		await expect(spoken).rejects.toThrow(/synthesis-failed/);
		expect(stub.utterances).toHaveLength(2);
	});

	it('falls back to the content language when the voice is not installed', async () => {
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		void backend.speak({ text: 'مرحبا.', voiceName: 'Missing', lang: 'ar', rate: 1 });

		expect(stub.live.lang).toBe('ar');
		expect(stub.live.voice).toBe(null);
	});

	it('cancels an in-flight utterance before starting the next one', async () => {
		const stub = stubHost();
		const backend = createWebSpeechBackend(stub.host);

		const first = backend.speak({ text: 'One.', voiceName: 'Alice', lang: 'en', rate: 1 });
		void backend.speak({ text: 'Two.', voiceName: 'Alice', lang: 'en', rate: 1 });

		expect(await first).toBe('interrupted');
		expect(stub.live.text).toBe('Two.');
	});
});
