# Narration is client-side, and Arabic Articles are not narrated

Narration is synthesized entirely in the browser via the Web Speech API for
Latin-script (e.g. English) Articles — free, offline, no server cost. The
server-side TTS path (`GET /api/articles/:id/audio` + Cloudflare Workers AI
`@cf/deepgram/aura-1`) is removed. **Arabic Articles are not narrated at all: the
play button / TTS player is hidden for them.**

## Context

The original bug: Arabic Articles "read numbers/English but not Arabic." The cause
was the client-side Web Speech path falling back to an English voice when no Arabic
voice was installed, vocalizing only Latin/digits.

We then discovered the hard constraint that decides everything: **on the target
devices (Windows desktop, Android) the platform TTS engine cannot supply an Arabic
voice to Web Speech at all** — none is installed and none is installable. So
client-side Arabic narration is impossible, full stop.

Arabic-capable server synthesis does exist (Cloudflare Workers AI `inworld/tts-2`,
Arabic in production), and could be made offline by caching generated clips. We
deliberately rejected it **for now**: it reintroduces per-Article generation cost
and server dependence, against the app's cost/offline drivers, for a feature whose
value didn't justify that complexity at personal/family scale.

## Decision & consequences

- **One playback engine** (Web Speech). The `isLocal`/server branches and the audio
  endpoint are deleted.
- **Local voices only**, so narration survives offline. The network-only "Google
  Neural" voices are not preferred.
- **Arabic Articles hide the player.** Detection of Arabic content (already present as
  `isArabicContent`) drives hiding the play/TTS UI instead of attempting synthesis.
- **Other no-voice cases** (a non-Arabic Article whose language has no installed local
  voice): disable play with a "no voice installed — install steps" prompt rather than a
  silent wrong-language fallback.
- **Accepted trade-offs:** Arabic Articles are read-only (no audio); English desktop
  voice quality may be below the former Deepgram voices; narration depends on a voice
  being installed per device. All acceptable for controlled family devices.

## If revisited

Arabic narration is a clean add-on later: synthesize Arabic per-sentence via
`inworld/tts-2` server-side and cache the clips through the service worker (ADR-0002)
for offline replay — generating either on first online play (cheapest) or eagerly at
library-cache time. The decision recorded here is "not yet," not "never."
