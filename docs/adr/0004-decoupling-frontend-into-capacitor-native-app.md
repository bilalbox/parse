# Decoupling frontend into a Capacitor native app

We are wrapping the static SvelteKit frontend in Capacitor to create a native Android app, decoupling it from the Cloudflare Worker backend. This enables background/locked-screen Narration via native Foreground Service and Media Session plugins, and paves the way for future on-device AI plugins.

## Consequences

- **Server URL**: The app is no longer served from the same domain as the API. The UI must prompt the user for their "Server URL" (stored in settings) and prepend it to all `authFetch` calls.
- **CORS**: The Cloudflare Worker must strictly allow CORS requests from `http://localhost` and `capacitor://localhost`.
- **Service Worker**: The offline caching logic (`cache-convention.ts`) must intercept absolute, cross-origin URLs pointing to the configured Server URL instead of just relative paths.
- **Narration**: We retain JS-driven, sentence-by-sentence Web Speech synthesis (ADR-0001), but it will be kept awake in the background using a Capacitor Foreground Service plugin, rather than handing the entire article text to a native TTS engine.
