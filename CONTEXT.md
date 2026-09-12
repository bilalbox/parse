# parse

A read-it-later worker that turns messy web pages and inbound newsletters into clean, stored Articles.

## Language

**Article**:
A single saved, reader-ready item — the cleaned content (a Readability result) plus its metadata (title, author, url, source type, unsubscribe info). The unit the library lists, reads, summarizes, archives, and deletes.

**Source**:
The seam in front of the extraction spine. One adapter per ingest path (`WebSource`, `EmailSource`) supplies the raw HTML and the three things that differ per path: how an image `src` resolves to bytes, what content Readability dropped that must be rescued, and where an Article's metadata comes from.
_Avoid_: provider, channel, ingestor

**Extraction spine**:
The single shared pipeline (`extractArticle`) that every Source flows through: preprocess the DOM, run Readability, let the Source rescue dropped content, mediate images, and produce an Article. Deep module — most of the product's value lives here.
_Avoid_: parser, pipeline handler

**Rescue**:
Re-attaching content Readability discarded as boilerplate — the web featured image, or an email's dropped large images and call-to-action links. Supplied by the Source as a hook over the parsed Article document. The class names it writes are a contract across three runtimes — the ingest adapters that write them, Narration and the reader that match them, the stylesheet that styles them — and live in `src/lib/rescue.ts`, imported rather than retyped. `src/app.css` is the one consumer that cannot import them, so a guard test holds it to them.

**Summary**:
A short markdown digest of an Article (main points / surprises / actionable tools), generated once by a Workers AI model and stored on the Article. The summarization module (`src/summarize.ts`) is the one place the model id, prompt, truncation, and response-shape handling live — both ingest paths (the summarize endpoint and the email handler) cross it. Deep module: callers hand it `(id, text)` and get a stored Summary; the AI binding and persistence sit behind the seam.
_Avoid_: digest, TL;DR

**Article content envelope**:
The stored `content` blob — a JSON-encoded Readability result — and the one client module that parses and presents it (`src/lib/article-content.ts`). Hands out the title, byline, sanitized and tidied body HTML, plain text, the **content language** each consumer needs, and compiled summary HTML. The API response and the stored shape are unchanged, deliberately: returning a parsed envelope from the server would stale every offline-cached Article response. Deriving the language here rather than from rendered DOM is what lets the reader decide whether to offer Narration before the body mounts. Absorbs the DOM tidying and sanitization pass so callers receive ready-to-mount HTML.
_Avoid_: payload, content JSON, article data

**Library**:
The client module and domain store owning active and archived Articles — listing, searching, queueing new URLs for extraction, archiving, deleting, unsubscribing, and autonomous offline cache mirroring (ADR-0002). All Article mutations and cache synchronization sit behind this seam.
_Avoid_: article list, library manager

**Archive**:
Moving an Article out of the library without deleting it; its content and media stay.

**Media**:
Images pulled out of an Article during extraction, uploaded to R2, and referenced in stored content as `/media/<key>`.

**Offline cache convention**:
The single source of truth for how the offline Library is cached (ADR-0002): the cache names, the `/media/<key>` pattern, and which request paths are runtime-cacheable. Lives in `src/lib/cache-convention.ts` and is shared via ESM imports by both the SvelteKit frontend (which warms/evicts the runtime cache) and the service worker (`src/service-worker.ts`, which serves network-first). The server's `extractMediaKeys` mirrors the same `/media/<key>` shape in its own runtime.
_Avoid_: cache config, sw helpers

**Narration**:
Reading an Article aloud, sentence by sentence with the current sentence highlighted. Synthesized on-device using a voice installed for the Article's language — never a server-rendered audio stream. Two backends behind one shared **Segmentation** pass: the browser **Web Speech API** in the PWA, and the device's native TTS via `@capacitor-community/text-to-speech` on Android, where the WebView has no `speechSynthesis` engine (ADR-0005). The player (`src/lib/narration.svelte.ts`) owns the queue, playback and highlighting; `src/lib/tts.svelte.ts` is the wiring that hands it a platform engine and exports the singleton the app talks to. Arabic Articles are not narrated (no client Arabic voice exists on the target devices); their play control is hidden.
_Avoid_: TTS, audio, playback

**Speech backend**:
The seam in front of the two synthesis engines (`src/lib/speech.ts`), the same shape as the ingest **Source** seam: one adapter per platform supplying the three things that differ — speaking a sentence, stopping, and enumerating voices — plus an optional playback session, which is how Android holds an OS background task across an Article without the player having to know it exists. `src/lib/speech-backend.ts` is the single place the platform choice is made. Speaking resolves an outcome, `completed` or `interrupted`, and rejects only on a genuine engine failure, so interruption is a normal event rather than something the player reconstructs from its own state. Engine quirks stay in their adapter — Android Chrome's retry without a pinned voice, the native engine addressing voices by position — while the dedupe and prefer-on-device voice rule stays above the seam, in the player, so the two backends cannot drift.
_Avoid_: TTS engine, synthesizer, voice provider

**Segmentation**:
Turning a mounted Article container into the sentence queue Narration reads, wrapping each sentence in a `.tts-sentence` span so highlighting and click-to-jump can find it. One idempotent entry point (`segmentContainer` in `src/lib/segmentation.ts`) takes the container and the content language; re-running it on an already-segmented container is safe, because the reader's attachment fires twice on a single mount. It builds nodes from the container's own document rather than a global one, which is what makes it callable without a browser. Must run *after* the tidy pass — tidying deletes blocks, and deleting a block after segmentation leaves holes in the sentence index.
_Avoid_: sentence splitting, chunking, tokenization
