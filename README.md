# parse

A read-it-later app that turns messy web pages and inbound newsletters into clean, stored
**Articles**. The backend is a Cloudflare Worker (Hono); the frontend is a static SvelteKit
SPA that ships in two forms from the **same build**:

- a **PWA** served by the Worker at `parse.23p.dev`, and
- a **native Android app** (Capacitor) published to Google Play.

For the domain model and terminology, see [`CONTEXT.md`](CONTEXT.md). Architecture decisions
live in [`docs/adr/`](docs/adr/).

## Prerequisites

- **Node.js 22** (matches CI).
- **pnpm 11** is the canonical package manager. CI builds with `pnpm install`, so `pnpm-lock.yaml`
  is the source of truth — use `pnpm install`, not npm/yarn.
- For Android: Android Studio (or a JDK 21 + Android SDK), used only for the native build.

```bash
pnpm install
```

## The shared build

One command builds the frontend for every target:

```bash
pnpm run build      # vite build → SvelteKit adapter-static writes to ./public
```

`./public/` is **generated output and is not committed** (it is in `.gitignore`). It is, at
once, the SvelteKit static output, the Worker's `assets` directory (see `wrangler.jsonc`), and
Capacitor's `webDir` (see `capacitor.config.ts`). Because all three read from `public/`, every
deploy path below builds first so you can never ship stale artifacts.

Other scripts:

| Command | Purpose |
|---------|---------|
| `pnpm run dev` | Local Worker + frontend (`wrangler dev`) |
| `pnpm run check` | `svelte-check` type/diagnostics pass |
| `pnpm test` | Vitest (Cloudflare Workers pool) |
| `pnpm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing bindings in `wrangler.jsonc` |

## Deploy target 1 — PWA + API (Cloudflare Worker)

The Worker serves both the API (`/api/*`, `/media/*`, run worker-first) and the PWA assets at
the custom domain `parse.23p.dev`.

```bash
pnpm run deploy     # = pnpm run build && wrangler deploy
```

Deployment is **manual** from a developer machine — there is no Cloudflare Git/Workers Builds
integration. Always use `pnpm run deploy` (never bare `wrangler deploy`) so `public/` is rebuilt
first.

Backend resources are bound in `wrangler.jsonc`: D1 (`DB`), R2 (`MEDIA_BUCKET`), Browser
Rendering (`BROWSER`), Workers AI (`AI`), and a Queue (`PARSE_QUEUE`). Secrets are set with
`wrangler secret put`, not committed.

## Deploy target 2 — Android app (Capacitor)

The Android app is the **same web build** wrapped by Capacitor (`appId: com.twenty3p.parse`).
Unlike the PWA it is **not** served same-origin with the API, which drives two requirements
(see [ADR-0004](docs/adr/0004-decoupling-frontend-into-capacitor-native-app.md)):

- **Server URL**: the app has no built-in API host. The user enters their Worker URL
  (e.g. `https://parse.23p.dev`) in Settings; it is stored and prepended to every API call.
- **CORS**: the Worker must allow `capacitor://localhost` and `http://localhost` origins.

Narration (read-aloud) differs by target: the PWA uses the browser **Web Speech API**, while
the Android WebView ships no speech engine and instead bridges to the device's native TTS via
`@capacitor-community/text-to-speech` (per-sentence). See
[ADR-0005](docs/adr/0005-native-on-device-tts-on-android.md).

### Local Android build

```bash
pnpm run sync:android   # build web + copy into android/ (npx cap sync android)
pnpm run open:android   # the above, then open Android Studio to run/debug
```

`cap sync` regenerates the generated gradle files (e.g. `android/capacitor.settings.gradle`),
so any package-manager-specific paths in them are overwritten on each sync — don't hand-edit.

### Release build (CI)

Pushing a `v*` tag triggers `.github/workflows/android-release.yml`, which runs
`pnpm install → pnpm run build → npx cap sync android`, builds a signed APK + AAB with gradle, drafts
a GitHub Release, and uploads the AAB to the Play **internal** track.

```bash
git tag v1.2.3 && git push origin v1.2.3
```

The version name comes from the tag (`v1.2.3` → `1.2.3`); the version code is the CI run
number. Signing uses repository secrets, not a committed keystore (`*.keystore` is gitignored):

| Secret | Purpose |
|--------|---------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Signing key alias |
| `ANDROID_KEY_PASSWORD` | Signing key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play Console service account for upload |

## Database

Schema lives in `schema.sql`; migrations in `migrations/`. Apply with
`wrangler d1 migrations apply parse-db` (add `--remote` for the deployed database).
