# Offline-first reading: service-worker library cache

To let the whole reading + narration experience work with no network, the service
worker (`public/sw.js`, currently a no-op) becomes a real cache: it precaches the
app shell and mirrors the active Library into Cache Storage, so any Article you can
see in the list is readable and narratable offline.

## Decision

- **App shell** (`index.html`, `app.js`, `style.css`, icon, manifest): precached on SW
  install, served **cache-first**, with a versioned cache name busted on SW update.
- **Library + Article content**: served **network-first, cache fallback** — fresh when
  online, instant/available when offline.
- **Auto-cache the whole active Library.** On every successful online library load, diff
  the active (non-archived) Article list against the cache: background-fetch any missing
  Article HTML + its `/media/*` images, and **evict** anything no longer in the active
  list (archived/deleted Articles leave the cache). The offline cache stays == the
  current Library, with no per-Article "save offline" UI. Sized for an expected active
  Library under ~200 Articles; quota-exceeded errors are handled gracefully rather than
  assuming unbounded storage.
- **Writes are online-only.** Add-article, Archive, Delete, and Summarize are disabled
  with clear messaging when offline (no Background Sync outbox). Offline is for
  *consuming* Articles, not mutating them — chosen over a Background Sync queue because
  of its complexity and lack of iOS Safari support.

## Considered & rejected

- **Cache-on-read** (cache an Article only after opening it online): backwards for a
  read-it-later app — you can't grab *unread* Articles before going offline.
- **Explicit per-Article "save for offline"**: more UI/state than warranted at family
  scale, where auto-mirroring the whole Library is simpler and matches the mental model
  "what I see is what I have offline."
