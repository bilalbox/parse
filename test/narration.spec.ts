import { describe, it, expect, beforeEach } from 'vitest';
import { parseHTML } from 'linkedom';
import { NarrationPlayer } from '../src/lib/narration.svelte';
import type { SpeakRequest, SpeakOutcome, SpeechBackend, Voice } from '../src/lib/speech';
import { settings } from '../src/lib/settings.svelte';

/**
 * A backend that records what it was asked to say and hands the test the
 * settling of each utterance. This is what the seam buys: the playback state
 * machine can be driven without an engine, a browser, or a device.
 */
function fakeBackend(voices: Voice[] = [{ name: 'Alice', lang: 'en-US' }]) {
	const spoken: SpeakRequest[] = [];
	let pending: { resolve: (o: SpeakOutcome) => void; reject: (e: unknown) => void } | null = null;
	let sessions = 0;

	const backend: SpeechBackend = {
		async listVoices() {
			return voices;
		},
		onVoicesChanged() {},
		speak(request) {
			spoken.push(request);
			return new Promise<SpeakOutcome>((resolve, reject) => {
				pending = { resolve, reject };
			});
		},
		async stop() {
			const current = pending;
			pending = null;
			current?.resolve('interrupted');
		},
		async beginSession() {
			sessions++;
		},
		async endSession() {
			sessions--;
		}
	};

	return {
		backend,
		spoken,
		get lastSpoken() {
			return spoken[spoken.length - 1];
		},
		get sessions() {
			return sessions;
		},
		/** The utterance ran to its end. */
		complete() {
			const current = pending;
			pending = null;
			current?.resolve('completed');
		},
		/** The engine genuinely failed, as opposed to being cancelled. */
		fail(error: unknown) {
			const current = pending;
			pending = null;
			current?.reject(error);
		}
	};
}

const ARTICLE = '<p>One here. Two here.</p><p>Three here.</p>';

function container(html = ARTICLE): Element {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	return document.getElementById('root') as unknown as Element;
}

/** Let the player's awaited backend calls settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * A player already loaded with an Article and ready to play. `schedule` runs the
 * deferred segmentation frame immediately — the deferring itself is a paint
 * concern, guarded end-to-end.
 */
async function loadedPlayer(fake = fakeBackend(), html = ARTICLE) {
	const player = new NarrationPlayer(fake.backend, { schedule: (task) => task() });
	await flush();
	player.loadArticle('article-1', 'A Title', 'An Author', container(html));
	return player;
}

beforeEach(() => {
	settings.setNarrationSpeed(1.0);
	settings.setNarrationVoice('en', '');
	settings.setNarrationVoice('ar', '');
});

describe('NarrationPlayer', () => {
	describe('loading an Article', () => {
		it('queues its sentences', async () => {
			const player = await loadedPlayer();

			expect(player.sentences.map((s) => s.text.trim())).toEqual([
				'One here.',
				'Two here.',
				'Three here.'
			]);
			expect(player.currentIndex).toBe(0);
		});

		it('carries the Article title and author for the player chrome', async () => {
			const player = await loadedPlayer();

			expect(player.articleTitle).toBe('A Title');
			expect(player.articleAuthor).toBe('An Author');
		});
	});

	describe('playing through the queue', () => {
		it('speaks the first sentence with the resolved voice and speed', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();

			expect(fake.lastSpoken).toMatchObject({
				text: 'One here. ',
				voiceName: 'Alice',
				lang: 'en',
				rate: 1.0
			});
		});

		it('advances to the next sentence when one completes', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			fake.complete();
			await flush();

			expect(player.currentIndex).toBe(1);
			expect(fake.lastSpoken.text.trim()).toBe('Two here.');
		});

		it('stops at the end of the queue', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			for (let i = 0; i < 3; i++) {
				await flush();
				fake.complete();
			}
			await flush();

			expect(player.isPlaying).toBe(false);
			expect(player.currentIndex).toBe(0);
			expect(fake.spoken).toHaveLength(3);
		});

		it('holds a playback session for as long as it is playing', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			expect(fake.sessions).toBe(1);

			player.pause();
			await flush();
			expect(fake.sessions).toBe(0);
		});
	});

	describe('interruption', () => {
		it('does not advance when pausing cuts a sentence short', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			player.pause();
			await flush();

			expect(player.isPlaying).toBe(false);
			expect(player.currentIndex).toBe(0);
			expect(fake.spoken).toHaveLength(1);
		});

		it('starts the next sentence when skipping cuts one short', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			player.nextSentence();
			await flush();

			expect(player.currentIndex).toBe(1);
			expect(fake.lastSpoken.text.trim()).toBe('Two here.');
			// The interrupted first sentence must not also advance the queue.
			expect(fake.spoken).toHaveLength(2);
		});

		it('does not queue a sentence twice when an interruption and a completion race', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			player.jumpToSentence(2);
			await flush();
			// The utterance for sentence 2 completing must advance past the end,
			// not resurrect the abandoned first one.
			fake.complete();
			await flush();

			expect(player.isPlaying).toBe(false);
			expect(fake.spoken.map((s) => s.text.trim())).toEqual(['One here.', 'Three here.']);
		});
	});

	describe('changing how it sounds mid-playback', () => {
		it('re-speaks the current sentence at the new speed', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			player.setSpeed(1.5);
			await flush();

			expect(fake.lastSpoken).toMatchObject({ text: 'One here. ', rate: 1.5 });
			expect(player.currentIndex).toBe(0);
		});

		it('re-speaks the current sentence in the new voice', async () => {
			const fake = fakeBackend([
				{ name: 'Alice', lang: 'en-US' },
				{ name: 'Basma', lang: 'en-GB' }
			]);
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			player.setVoice('Basma');
			await flush();

			expect(fake.lastSpoken).toMatchObject({ text: 'One here. ', voiceName: 'Basma' });
		});

		it('remembers speed and voice as preferences, not playback state', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.setSpeed(1.75);
			player.setVoice('Alice');

			expect(settings.narrationSpeed).toBe(1.75);
			expect(settings.narrationVoice('en')).toBe('Alice');
		});
	});

	describe('a genuine engine failure', () => {
		it('stops playback rather than stalling on a dead sentence', async () => {
			const fake = fakeBackend();
			const player = await loadedPlayer(fake);

			player.play();
			await flush();
			fake.fail(new Error('synthesis-failed'));
			await flush();

			expect(player.isPlaying).toBe(false);
			expect(fake.spoken).toHaveLength(1);
		});
	});

	describe('moving around the Article', () => {
		it('seeks to the sentence a fraction of the way through', async () => {
			const player = await loadedPlayer();

			player.seekToFraction(0.5);

			expect(player.currentIndex).toBe(1);
		});

		it('clamps a seek to the ends of the queue', async () => {
			const player = await loadedPlayer();

			player.seekToFraction(1.4);
			expect(player.currentIndex).toBe(2);

			player.seekToFraction(-0.2);
			expect(player.currentIndex).toBe(0);
		});

		it('ignores a seek on an empty queue', async () => {
			const player = await loadedPlayer(fakeBackend(), '<div>no blocks here</div>');

			player.seekToFraction(0.5);

			expect(player.currentIndex).toBe(0);
		});

		it('marks the current sentence so the reader can follow along', async () => {
			const player = await loadedPlayer();

			player.jumpToSentence(1);

			expect(player.sentences[1].elements[0].classList.contains('active-sentence')).toBe(true);
			expect(player.sentences[0].elements[0].classList.contains('active-sentence')).toBe(false);
		});
	});

	describe('the voices it offers', () => {
		it('keeps one voice per locale, preferring on-device over network', async () => {
			const fake = fakeBackend([
				{ name: 'Alice (Network)', lang: 'en-US' },
				{ name: 'Alice', lang: 'en-US' },
				{ name: 'Bob', lang: 'en-GB' }
			]);
			const player = new NarrationPlayer(fake.backend, { schedule: (task) => task() });
			await flush();

			expect(player.getUsableVoices().map((v) => v.name)).toEqual(['Bob', 'Alice']);
		});

		it('drops voices in languages narration does not offer', async () => {
			const fake = fakeBackend([
				{ name: 'Alice', lang: 'en-US' },
				{ name: 'Yuki', lang: 'ja-JP' }
			]);
			const player = new NarrationPlayer(fake.backend, { schedule: (task) => task() });
			await flush();

			expect(player.getUsableVoices().map((v) => v.name)).toEqual(['Alice']);
		});

		it('reports no voice for an Arabic Article when only English is installed', async () => {
			const fake = fakeBackend();
			const player = new NarrationPlayer(fake.backend, { schedule: (task) => task() });
			await flush();

			player.loadArticle('ar-1', 'عنوان', 'كاتب', container('<p>الجملة الأولى.</p>'));

			expect(player.isArabicContent).toBe(true);
			expect(player.hasVoice).toBe(false);
			expect(player.selectedVoice).toBe('');
		});

		it('honours a saved voice preference for the content language', async () => {
			settings.setNarrationVoice('en', 'Bob');
			const fake = fakeBackend([
				{ name: 'Alice', lang: 'en-US' },
				{ name: 'Bob', lang: 'en-GB' }
			]);
			const player = new NarrationPlayer(fake.backend, { schedule: (task) => task() });
			await flush();

			expect(player.selectedVoice).toBe('Bob');
		});
	});
});
