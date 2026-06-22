# Plan 002: Dead-letter queue / status reporting for ingest failures

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fb4b835..HEAD -- src/index.ts src/store.ts schema.sql`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 001
- **Category**: correctness / feature
- **Planned at**: commit `fb4b835`, 2026-06-22

## Why this matters

Currently, if an incoming email or queued URL fails to parse during `extractArticle`, the error is simply logged to the Worker's console and the data is dropped. The sender (the user) has no idea the ingestion failed and the article is lost. Adding an `ingest_failures` table allows the frontend to show the user which links or emails failed, so they can manually retry or investigate.

## Current state

- `src/index.ts`: The email handler catches the error, logs it, and moves on without rejecting or storing the failure. The queue handler calls `msg.retry()` but eventually drops it when retries are exhausted.
  ```typescript
  } catch (err) {
      console.error('Email parse failed:', messageId, err);
  }
  ```
- `schema.sql`: Does not have a table for failures.
- `src/store.ts`: Has no methods for recording failures.

## Commands you will need

| Purpose   | Command                                         | Expected on success |
|-----------|-------------------------------------------------|---------------------|
| Typecheck | `pnpm run check`                                | exit 0              |
| Test      | `pnpm test`                                     | all pass            |
| Migrate   | `npx wrangler d1 migrations create parse-db ...`| exit 0              |

## Scope

**In scope**:
- `schema.sql`
- `migrations/XXXX_add_ingest_failures.sql` (create)
- `src/store.ts`
- `src/index.ts`
- `src/routes/+layout.svelte` (or a new route to view failures)

**Out of scope**:
- Implementing automatic retry logic beyond what Cloudflare Queues already does.
- Changing the extraction logic itself.

## Git workflow

- Branch: `advisor/002-add-dead-letter-queue`
- Commit message: `feat: record ingest failures to database for visibility`

## Steps

### Step 1: Database Migration

Create a new local migration file to add an `ingest_failures` table.
The table should have: `id` (TEXT PRIMARY KEY), `url_or_subject` (TEXT), `error_message` (TEXT), and `created_at` (DATETIME).
Update `schema.sql` to match.
Apply the migration locally using `wrangler d1 migrations apply parse-db --local`.

**Verify**: The `ingest_failures` table is created successfully in the local SQLite DB.

### Step 2: Store logic

In `src/store.ts`, add an interface and implementation for `recordFailure(urlOrSubject: string, errorMessage: string): Promise<void>`. Add a method `listFailures(): Promise<{url_or_subject: string, error_message: string, created_at: string}[]>` and `clearFailure(id: string)`.

**Verify**: `pnpm run check` exits 0.

### Step 3: Record failures in Handlers

In `src/index.ts`:
- In the `email` handler, on the catch block, extract the subject (`email.subject`) and error message (`err.message || String(err)`), and call `recordFailure`. Ensure it still logs to `console.error`.
- In the `queue` handler, when `msg.retry()` happens, or rather, if the retry count exceeds a threshold (or simply always record it when it fails to parse), record the URL and error message.

**Verify**: `pnpm run check` exits 0.

### Step 4: Add API Endpoint

In `src/index.ts`, add `app.get('/api/failures', ...)` to return the list of failures, and `app.delete('/api/failures/:id', ...)` to clear one. Apply `requireAuth`.

**Verify**: `pnpm run check` exits 0.

## Test plan

- Modify `test/index.spec.ts` to mock a failure during email parsing and verify `recordFailure` is called.
- Verification: `pnpm test` all pass.

## Done criteria

- [ ] New D1 migration created and `schema.sql` updated.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The local D1 database fails to apply the migration.
- `extractArticle` signature has changed significantly.

## Maintenance notes

- We might want to build a dedicated UI to view these in the Svelte app in the future. For now, the API must be wired up to store the data reliably.
