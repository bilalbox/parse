# Plan 006: Add Background Audio Playback for Capacitor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fb4b835..HEAD -- src/lib/tts.svelte.ts package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fb4b835`, 2026-06-22

## Why this matters

The TTS feature currently requires the app to remain in the foreground. For a podcast-like "read-it-later" companion app, users expect narration to continue when the screen is locked or the app is put in the background. Adding proper background execution support for Capacitor will bridge the existing MediaSession controls to true background audio playback.

## Current state

- `CONTEXT.md` explicitly lists narration as "Foreground-only (no background/locked-screen narration)".
- `src/lib/tts.svelte.ts`: `navigator.mediaSession` is configured, but playback stops when the OS suspends the WebView.

## Scope

**In scope**:
- `src/lib/tts.svelte.ts`
- `package.json`
- `android/` configuration files (if necessary, though Capacitor might handle it via plugins).
- `CONTEXT.md`

**Out of scope**:
- Changing how the sentences are chunked or which TTS plugin is used (`@capacitor-community/text-to-speech`).

## Git workflow

- Branch: `advisor/006-background-audio`
- Commit message: `feat: enable background audio playback on android`

## Steps

### Step 1: Investigate and Prototype (Design Spike)

This plan is a **design spike**. Your goal is to determine the best approach for keeping the Android WebView alive and playing TTS audio while in the background.
Options to investigate:
1. Capacitor Background Runner or `@capacitor/app` background tasks.
2. Capacitor Background Mode plugin (`@awesome-cordova-plugins/background-mode` or similar).

Implement a proof-of-concept in `tts.svelte.ts` that requests background execution when `play()` is called, and releases it on `stop()`.

**Verify**: The app can be built via `pnpm run build` without errors.

### Step 2: Implement Background Request

Add the chosen background mode initialization and permissions to the Android manifest if required.
In `tts.svelte.ts`, tie the background mode activation to the `isPlaying` state.

**Verify**: `pnpm run check` exits 0.

### Step 3: Update CONTEXT.md

Remove the "Foreground-only" restriction from `CONTEXT.md`.

## Done criteria

- [ ] A background execution strategy is implemented or a clear blocker is identified.
- [ ] `pnpm typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If `@capacitor-community/text-to-speech` fundamentally prevents background execution and a custom native plugin would be required to proceed, STOP and report.
