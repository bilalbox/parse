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
Re-attaching content Readability discarded as boilerplate — the web featured image, or an email's dropped large images and call-to-action links. Supplied by the Source as a hook over the parsed Article document.

**Summary**:
A short markdown digest of an Article (main points / surprises / actionable tools), generated once by a Workers AI model and stored on the Article. The summarization module (`src/summarize.ts`) is the one place the model id, prompt, truncation, and response-shape handling live — both ingest paths (the summarize endpoint and the email handler) cross it. Deep module: callers hand it `(id, text)` and get a stored Summary; the AI binding and persistence sit behind the seam.
_Avoid_: digest, TL;DR

**Library**:
The default list of active (non-archived) Articles.

**Archive**:
Moving an Article out of the library without deleting it; its content and media stay.

**Media**:
Images pulled out of an Article during extraction, uploaded to R2, and referenced in stored content as `/media/<key>`.

**Offline cache convention**:
The single source of truth for how the offline Library is cached (ADR-0002): the cache names, the `/media/<key>` pattern, and which request paths are runtime-cacheable. Lives in `src/lib/cache-convention.ts` and is shared via ESM imports by both the SvelteKit frontend (which warms/evicts the runtime cache) and the service worker (`src/service-worker.ts`, which serves network-first). The server's `extractMediaKeys` mirrors the same `/media/<key>` shape in its own runtime.
_Avoid_: cache config, sw helpers

**Narration**:
Reading an Article aloud, sentence by sentence with the current sentence highlighted. Synthesized on-device using a voice installed for the Article's language — never a server-rendered audio stream. Two backends behind one shared segmentation pipeline (`src/lib/tts.svelte.ts`): the browser **Web Speech API** in the PWA, and the device's native TTS via `@capacitor-community/text-to-speech` on Android, where the WebView has no `speechSynthesis` engine (ADR-0005). Foreground-only (no background/locked-screen narration). Arabic Articles are not narrated (no client Arabic voice exists on the target devices); their play control is hidden.
_Avoid_: TTS, audio, playback
