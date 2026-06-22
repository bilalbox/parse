# Plan 003: Migrate from URL Token to Cookie-based Auth

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fb4b835..HEAD -- src/index.ts src/lib/cache-convention.ts src/lib/Library.svelte.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 001
- **Category**: security
- **Planned at**: commit `fb4b835`, 2026-06-22

## Why this matters

The API allows passing the authentication token via the query string (`?token=...`) to support `<img src="/media/...">` loading from native DOM elements. However, passing Bearer tokens in URLs means they are permanently recorded in Cloudflare edge access logs, browser histories, and proxy logs. We need to transition to setting a secure Cookie upon authentication, which browsers automatically attach to image requests, allowing us to drop the query-string token completely.

## Current state

- `src/index.ts`: The auth middleware accepts `c.req.query('token')`.
  ```typescript
  const queryToken = c.req.query('token');
  if (auth === `Bearer ${token}` || queryToken === token) {
  ```
- `src/lib/Library.svelte.ts`: The frontend manually appends `?token=` to image URLs and API requests before caching them.
- `src/lib/settings.svelte.ts` (implied): Stores and manages `token`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm run check`         | exit 0              |
| Test      | `pnpm test`              | all pass            |

## Scope

**In scope**:
- `src/index.ts`
- `src/lib/Library.svelte.ts`
- `src/lib/settings.svelte.ts`
- `src/routes/article/[id]/+page.svelte` (if it appends tokens)

**Out of scope**:
- Changing the Capacitor Android app CORS/Cookie behaviour unless explicitly required. (Capacitor handles cookies well now, but ensure CORS allows credentials).

## Git workflow

- Branch: `advisor/003-migrate-to-cookie-auth`
- Commit message: `sec: transition from url token to cookie-based auth`

## Steps

### Step 1: Require credentials in CORS

In `src/index.ts`, update the `cors()` middleware for `/api/*` and `/media/*` to `credentials: true`. Wait, since `origin: '*'` is used, `credentials: true` is not allowed by browsers. You must reflect the `Origin` header dynamically.

```typescript
app.use('/api/*', cors({
	origin: (origin) => origin,
	credentials: true,
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Authorization', 'Content-Type']
}));
```

**Verify**: `pnpm run check` exits 0.

### Step 2: Establish the Cookie Route

In `src/index.ts`, create a new endpoint `POST /api/auth/login` that accepts `{ token: string }`. If it matches `c.env.PARSE_TOKEN`, set a cookie using `setCookie` from `hono/cookie`:
`Set-Cookie: PARSE_TOKEN=...; HttpOnly; Secure; SameSite=Lax; Path=/`

**Verify**: `pnpm run check` exits 0.

### Step 3: Update Auth Middleware

In `src/index.ts`, modify `requireAuth` to check the `PARSE_TOKEN` cookie via `getCookie(c, 'PARSE_TOKEN')` as a fallback if the `Authorization` header is missing. Remove the `queryToken` check entirely.

**Verify**: `pnpm run check` exits 0.

### Step 4: Update Frontend `settings.svelte.ts`

When the user configures their token in `settings.svelte.ts`, make a request to `POST /api/auth/login` to set the cookie. Ensure all `authFetch` calls set `credentials: 'include'`.

**Verify**: `pnpm run check` exits 0.

### Step 5: Remove Query String Appends

In `src/lib/Library.svelte.ts` and `src/routes/article/[id]/+page.svelte`, stop appending `?token=` to URLs. The `<img>` tags will now automatically send the cookie.

**Verify**: `pnpm run check` exits 0.

## Test plan

- Add a vitest test in `test/index.spec.ts` asserting that `GET /media/...` works with a Cookie, and rejects a query param.
- Verification: `pnpm test` all pass.

## Done criteria

- [ ] Query string `token=` is fully removed from backend auth.
- [ ] Cookies are used for authenticating media routes.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.

## STOP conditions

- Capacitor requires specific configurations for `SameSite` cookies that break the WebView (if so, STOP and report, we may need to reconsider the architecture).

## Maintenance notes

- Since the Android WebView and PWA rely on cookies, any domain mismatches will break image loading. The API server URL must correctly match the frontend origin or allow cross-origin cookies.
