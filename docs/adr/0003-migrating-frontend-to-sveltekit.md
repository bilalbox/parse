# 0003: Migrating Frontend to SvelteKit SPA Mode

To improve mobile UX, routing, and PWA integration, we are migrating the frontend from Vanilla JS (`public/app.js`, `public/index.html`) to SvelteKit in SPA (Single Page Application) mode.

## Context

The original frontend was built as a single-page HTML file with absolute-positioned elements toggled via DOM-manipulating JavaScript. This model introduced several limitations:
1. **Routing and History**: Bookmarking, refreshing, or using the hardware back button on mobile was fragile and required manually manipulating history state.
2. **PWA Shell Caching**: The static service worker required maintaining a hardcoded list of assets (`SHELL_ASSETS`). In a modern build pipeline where assets are hashed (to prevent stale browser cache), manual lists break on every deployment.
3. **State Management**: Authentication tokens, theme preference, and TTS settings were managed imperatively with direct `localStorage` reads/writes scattered across event handlers.
4. **Code Organization**: A single 1,500-line JS file (`app.js`) and a large CSS file (`style.css`) became difficult to maintain and extend.

## Decision

We chose to integrate SvelteKit directly into the existing repository in SPA mode:

- **Integration Mode**: Keep SvelteKit in SPA mode (`@sveltejs/adapter-static` outputting to `./public`) and run it alongside the existing Hono Worker backend. The Hono Worker remains responsible for `/api/*` routes, `/media/*` routes, and worker events (`queue` consumer and `email` receiver).
- **File-based Routing**: Split the views into distinct SvelteKit routes:
  - `/` (`src/routes/+page.svelte`): Dashboard and active/archived library.
  - `/article/[id]` (`src/routes/article/[id]/+page.svelte`): Clean article reader.
  - `/share` (`src/routes/share/+page.svelte`): PWA Web Share target / clipping view.
- **PWA Service Worker**: Port the service worker to SvelteKit's native service worker integration (`src/service-worker.ts`), letting Vite dynamically compile the worker and inject the hashed app-shell assets list via `import { build, files, version } from '$service-worker'`.
- **State via Svelte 5 Runes**: Manage all persistent preferences (API Token, Light/Dark Theme, font adjustments) in a centralized reactive store (`src/lib/settings.svelte.ts`) driven by Svelte 5 `$state` and `$effect` runes.
- **Global TTS Player**: Render the floating glassmorphic TTS Player globally in `src/routes/+layout.svelte` driven by a shared audio state manager (`src/lib/tts.svelte.ts`). This allows narration to continue playing in the background while the user navigates between the reader page and the library.
- **Transition Effects**: Replace raw CSS layout hacks with Svelte's high-performance native transition engine (`svelte/transition`) for page routing and card animations.

## Considered & Rejected

- **Full SvelteKit Cloudflare Adapter**: Rejected because Cloudflare Workers require custom entry points for receiving emails and consuming background queues. Adapting SvelteKit's Cloudflare adapter to export queue and email handlers requires complex, non-standard wrappers.
- **Passive Cache-on-Read PWA**: Rejected because the app needs to mirror the active library offline automatically. We retain the client-side warming and eviction sync loop in a Svelte `$effect`.
