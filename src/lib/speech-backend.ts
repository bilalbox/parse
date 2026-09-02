import { Capacitor } from '@capacitor/core';
import { createSilentSpeechBackend, type SpeechBackend } from './speech';
import { createNativeSpeechBackend } from './speech-native';
import { createWebSpeechBackend, type WebSpeechHost } from './speech-web';

/**
 * The one place the platform chooses a synthesis engine. Everything downstream
 * of here talks to the seam, so adding or fixing a backend means one branch,
 * not seven.
 */
export function createPlatformSpeechBackend(): SpeechBackend {
	if (Capacitor.isNativePlatform()) return createNativeSpeechBackend();
	if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
		return createWebSpeechBackend(window as unknown as WebSpeechHost);
	}
	return createSilentSpeechBackend();
}
