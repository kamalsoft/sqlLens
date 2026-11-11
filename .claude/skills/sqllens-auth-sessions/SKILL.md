---
name: sqllens-auth-sessions
description: Use when changing login, sessions, cookies, password hashing, rate limits, or share access. Security sign-off required.
---
# Auth, sessions, and rate limits

Last verified: `b90cda9` · Sources: `src/lib/auth.ts`, `src/lib/password.ts`, `src/lib/request-guard.ts`, `src/app/api/auth/{login,logout,me}/route.ts`, `src/app/api/share/[token]/route.ts`, `src/proxy.ts`, `scripts/set-admin-password.ts`, `.team/decisions.md` (D-006, D-008, D-025, D-027)

**Security sign-off is mandatory** for auth, sessions, credentials, and share access (CLAUDE.md). Use the `security` agent or request a review before merging.

## Model (approved)
- One local admin (D-006). No multi-user, no external IdP.
- Admin password is set by an npm script that prompts for it (D-027 C): `npm run admin:set-password`. No password in env vars or over the network.
- Share links require a login as well as the token (D-025 B). `src/app/api/share/[token]/route.ts` calls `requireSession` before `lookupShare`.

## Password hashing
- `src/lib/password.ts`: `scrypt$N$r$p$salt$key`, using `node:crypto` `scryptSync` with a random salt and `timingSafeEqual` on verify. Use `hashPassword` and `verifyPassword` only.
- Migration `002_auth` disabled every non-scrypt hash (`'!disabled'`). Any new account must be created through `hashPassword`.

## Sessions
- Cookie `session_token` (`SESSION_COOKIE`). Lifetime `SESSION_TTL_MS` = 7 days.
- Table `sessions(id, user_id, token, is_active, expires_at, last_accessed_at)`.
- `createSession` mints the token. `getSessionFromRequest` (`src/lib/auth.ts`) requires `is_active = 1` and an unexpired `expires_at`, then updates `last_accessed_at`. Read those lines before changing the lookup.
- `requireSession(request)` returns `{ ok: true, session }` or `{ ok: false, response }` (401). All 16 protected routes use it. Only `auth/login`, `auth/logout`, and `auth/me` do not, by design.
- Cookie flags are set in `setSessionCookie` / cleared in `clearSessionCookie`. Keep the flags. Don't weaken them to make local testing easier.
- Logout calls `invalidateSession(token)`, which marks the row inactive.

## Rate limiting
- `rateLimit(key, limit, windowMs)` is an in-memory token bucket (`src/lib/request-guard.ts`). It is per process, so it resets on restart. This is accepted for one local process (D-008). Do not claim it protects a multi-instance deployment.
- Login: `loginAllowed(request, username)`: 5/min per IP, 20/min global, 5/min per username.
- Expensive routes use a per-session key, for example `refactor:<sessionId>` at 5/min. Return 429 with a clear message.
- `clientKey` trusts `X-Forwarded-For` **only** when `SQLLENS_TRUST_PROXY=1`. Setting that flag behind a proxy you do not control lets a client spoof its IP and bypass the limit. Document any change to it.

## Error and log hygiene
- 401 for no or expired session, 403 for a signed-in user without rights, 429 for rate limits. Use generic messages.
- Log through `logError` (`src/lib/redact.ts`). Never log passwords, session tokens, HF tokens, or DB connection strings.

## Verify
- Unit tests for `hashPassword`/`verifyPassword` round-trip and a wrong password.
- Route tests: no cookie → 401; expired `expires_at` → 401; revoked (`is_active = 0`) → 401; login rate limit trips on the 6th attempt.
- `npm test`, `npm run typecheck`, `npm run build`.

## Don't
- Don't reintroduce an anonymous session fallback. The target is removal (see `sqllens-api-route-patterns`).
- Don't add a route that skips `requireSession` unless it is one of the three auth routes. Say why in the PR.
- Don't return secrets from any route. The current `GET /api/appconfig` returns `apiKey`; treat it as a known issue to fix, not a pattern to copy.
- Don't store session tokens in `localStorage` or log them.
