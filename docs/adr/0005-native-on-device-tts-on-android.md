# Android Narration uses the device's native TTS engine, not Web Speech

On Android (Capacitor), Narration is synthesized by bridging to the device's native
`TextToSpeech` engine via `@capacitor-community/text-to-speech`, one sentence at a
time. The PWA path is unchanged — browsers still use the Web Speech API (ADR-0001).
There is no Capacitor Foreground Service plugin.

## Context

ADR-0004 anticipated keeping the existing Web Speech, sentence-by-sentence path and
merely keeping JS awake in the background with a Foreground Service plugin. That turned
out to be unworkable: **the Android System WebView ships no `speechSynthesis` engine**,
so `window.speechSynthesis` is absent inside the Capacitor WebView and there is nothing
to keep awake. The web TTS path simply produces no audio on-device.

## Decision & consequences

- **Two synthesis backends, one segmentation pipeline.** Sentence splitting,
  highlighting, and progress stay in shared client code (`src/lib/tts.svelte.ts`).
  `Capacitor.isNativePlatform()` selects the backend: Web Speech in browsers, the
  native plugin (`TextToSpeech.speak`/`getSupportedVoices`/`stop`) on Android.
- **Still on-device and offline.** The native engine uses voices installed on the
  device — no server-rendered audio stream, consistent with ADR-0001's drivers. The
  per-sentence loop and "local voices only" stance carry over.
- **Arabic is still not narrated.** No client/native Arabic voice exists on the target
  devices; the play control stays hidden for Arabic Articles (ADR-0001).
- **No Foreground Service plugin.** Narration is foreground-only on Android, same as
  the PWA. Backgrounded/locked-screen narration is not supported.

## Supersedes

The Narration consequence of
[ADR-0004](0004-decoupling-frontend-into-capacitor-native-app.md). The rest of ADR-0004
(Server URL, CORS, cross-origin service-worker caching) still stands.
