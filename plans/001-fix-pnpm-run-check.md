# Plan 001: Fix `pnpm run check` baseline failures

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fb4b835..HEAD -- src/lib/Library.svelte.ts package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `fb4b835`, 2026-06-22

## Why this matters

The baseline verification command `pnpm run check` currently fails out of the box due to `unknown` type errors in `src/lib/Library.svelte.ts` and missing SvelteKit generated types. Fixing the type errors and ensuring the `.svelte-kit` directory is generated before type-checking allows developers to verify the codebase reliably, which is a prerequisite for safely executing all other plans.

## Current state

- `src/lib/Library.svelte.ts`: `data` is currently inferred as `unknown` when calling `res.json()`, causing TypeScript errors when accessing `data.error` and `data.content`.
  ```typescript
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error || 'Failed to update article');
  ```
- `package.json`: The `check` script runs `svelte-check` directly without ensuring SvelteKit's types are generated.
  ```json
  "check": "svelte-check --tsconfig ./tsconfig.json",
  ```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Sync Types| `npx svelte-kit sync`    | exit 0              |
| Check     | `pnpm run check`         | exit 0, no errors   |

## Suggested executor toolkit

- `svelte-code-writer` and `svelte-core-bestpractices` skills if you need to understand SvelteKit's `svelte-kit sync` command.

## Scope

**In scope**:
- `src/lib/Library.svelte.ts`
- `package.json`

**Out of scope**:
- Any actual functional changes to how the library fetches or caches articles.

## Git workflow

- Branch: `advisor/001-fix-pnpm-run-check`
- Commit message: `fix: resolve svelte-check type errors and sync script`

## Steps

### Step 1: Fix `unknown` type errors in Library

In `src/lib/Library.svelte.ts`, locate the three places where `res.json()` is parsed into `data` but typed as `unknown` (lines 61, 69, 110). Cast the result to `any` or to a precise interface so TypeScript knows it can access `.error` and `.content`.

**Verify**: The specific `Error: 'data' is of type 'unknown'` lines no longer appear when you run `pnpm run check` (though `$app` module errors may still appear until Step 2).

### Step 2: Ensure `svelte-kit sync` runs before check

Modify `package.json` to prepend `svelte-kit sync && ` to the `check` script, ensuring the `.svelte-kit/` directory and `$app` aliases are fully generated before `svelte-check` runs.

```json
"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
```

**Verify**: `pnpm run check` → exits 0 with no errors.

## Test plan

- Verification: `pnpm run check` should pass completely with `0 errors and 0 warnings`.
- Verification: `pnpm test` should continue to pass.

## Done criteria

- [ ] `pnpm run check` exits 0.
- [ ] No `unknown` type errors remain in `src/lib/Library.svelte.ts`.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The codebase has drifted since this plan was written and `Library.svelte.ts` no longer contains the `catch(() => ({}))` pattern.
- `svelte-kit sync` fails to generate the `$app` types.

## Maintenance notes

- Future scripts that rely on SvelteKit's virtual modules (`$app/stores`, `$lib`) must ensure `svelte-kit sync` is run beforehand.
