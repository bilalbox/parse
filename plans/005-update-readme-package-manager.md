# Plan 005: Align README.md with actual package manager (pnpm)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fb4b835..HEAD -- README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `fb4b835`, 2026-06-22

## Why this matters

The `README.md` currently instructs developers to use `npm install` and explicitly states `npm is the canonical package manager`. However, recent commits migrated the project fully to `pnpm 11`, adding a `pnpm-lock.yaml` and `pnpm-workspace.yaml`. Correcting the documentation prevents onboarding confusion and prevents contributors from accidentally creating `package-lock.json` files.

## Current state

- `README.md`:
  ```markdown
  - **npm** is the canonical package manager. CI builds with `npm ci`, so `package-lock.json`
    is the source of truth — use `npm install`, not pnpm/yarn.
  ```
  ```bash
  npm install
  npm run build
  ...
  ```

## Commands you will need

None required, this is a documentation update.

## Scope

**In scope**:
- `README.md`

**Out of scope**:
- Modifying actual CI workflows.

## Git workflow

- Branch: `advisor/005-update-readme-pnpm`
- Commit message: `docs: update README to reflect pnpm migration`

## Steps

### Step 1: Update Prerequisites

Change the prerequisites section in `README.md` to indicate that `pnpm` is the required package manager and remove the warning against using pnpm.

**Verify**: The markdown renders correctly and the instruction to use `npm` is entirely gone.

### Step 2: Update all command references

Find and replace all `npm install`, `npm run`, and `npm test` references with their `pnpm` equivalents (`pnpm install`, `pnpm run`, `pnpm test`). Note that the CI command `npm ci` should be described as `pnpm install --frozen-lockfile` or simply `pnpm install` depending on what the CI actually uses.

**Verify**: No `npm run` commands remain in the README.

## Done criteria

- [ ] All instances of `npm` replaced with `pnpm` in `README.md`.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The `README.md` file no longer contains the old `npm` instructions (it may have been fixed out of band).
