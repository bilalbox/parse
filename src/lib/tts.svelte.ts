/**
 * The Narration player the app talks to.
 *
 * The class lives in `narration.svelte.ts` and this module only wires it to a
 * platform engine. The split is what keeps the player testable: importing a
 * Capacitor plugin pulls in a bridge that does not load outside a WebView, so
 * anything that imports one cannot be loaded by the test suite.
 */
import { NarrationPlayer } from './narration.svelte';
import { createPlatformSpeechBackend } from './speech-backend';

export type { Sentence } from './segmentation';
export { NarrationPlayer };

export const tts = new NarrationPlayer(createPlatformSpeechBackend());
