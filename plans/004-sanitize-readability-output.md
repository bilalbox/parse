# Plan 004: Sanitize Readability Output

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fb4b835..HEAD -- src/routes/article/\[id\]/+page.svelte package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001
- **Category**: security
- **Planned at**: commit `fb4b835`, 2026-06-22

## Why this matters

The frontend currently uses Svelte's `{@html}` directive to render the parsed article content directly into the DOM. While Mozilla Readability removes obvious scripts and objects, it is not a dedicated security boundary and can be bypassed by sophisticated payloads. Running a dedicated sanitizer (like DOMPurify) right before rendering protects users from stored XSS if an ingested article contains malicious markup.

## Current state

- `src/routes/article/[id]/+page.svelte`: Renders the extracted HTML blindly.
  ```svelte
  <div class="article-body">
      {@html rewriteHtmlContent(payload.content)}
  </div>
  ```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm add dompurify` and `pnpm add -D @types/dompurify` | exit 0              |
| Typecheck | `pnpm run check`         | exit 0              |
| Test      | `pnpm test`              | all pass            |

## Scope

**In scope**:
- `src/routes/article/[id]/+page.svelte`
- `package.json`

**Out of scope**:
- Changing the backend `extractArticle` logic. We want to sanitize on the client immediately before render, which is standard practice for XSS prevention.

## Git workflow

- Branch: `advisor/004-sanitize-readability`
- Commit message: `sec: sanitize article content with dompurify before rendering`

## Steps

### Step 1: Install dependencies

Run `pnpm add dompurify` and `pnpm add -D @types/dompurify`.

**Verify**: Both packages appear in `package.json` and install successfully.

### Step 2: Implement DOMPurify

In `src/routes/article/[id]/+page.svelte`:
Import DOMPurify: `import DOMPurify from 'dompurify';`
Wrap `rewriteHtmlContent(payload.content)` with a call to DOMPurify. Note that `DOMPurify` might need to be configured to allow certain safe tags or if it needs to run in a browser-only environment. 

Since SvelteKit runs this on the client during SPA hydration, just ensure it doesn't break SSR (if SSR is ever enabled, though this is a static adapter PWA, so it runs entirely on the client).

```svelte
{@html DOMPurify.sanitize(rewriteHtmlContent(payload.content))}
```

**Verify**: `pnpm run check` exits 0.

## Test plan

- Create an article containing a malicious payload like `<img src="x" onerror="alert(1)">` and verify that the `onerror` attribute is stripped when viewed.
- Verification: `pnpm test` all pass.

## Done criteria

- [ ] `dompurify` is installed.
- [ ] The `{@html}` injection is protected by `DOMPurify.sanitize`.
- [ ] `pnpm typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- `DOMPurify` causes build failures due to missing DOM in an SSR environment. (If this occurs, wrap the sanitize call to only run if `typeof window !== 'undefined'`, and fallback to empty string on server).
