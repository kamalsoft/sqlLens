---
name: sqllens-api-route-patterns
description: Use when adding or changing any SQLLens API route handler — request validation, auth/session lookup, error responses, audit persistence, share tokens.
---
# API route patterns

Last verified: `22d84fa` · Sources: `src/app/api/**/route.ts`, `src/db/index.ts`

## Current patterns
- Session lookup (duplicated in 4 routes): cookie `session_token` → `SELECT id FROM sessions WHERE token = ? AND is_active = 1` (`audit/route.ts:7-13`). Write routes fall back to an `'anonymous'` session they create on the fly (`execute/route.ts:33-50`, `compare/route.ts:19-40`).
- Persistence: `INSERT INTO audit_requests (id, session_id, type, request_payload, response_payload, shared_token)` with `uuidv4()` ids (`execute/route.ts:81-91`).
- Errors: `catch (error: any) → { error: error.message }, 500` (leaks internals; lint `no-explicit-any`). Better pattern: `review/route.ts:291-303` (`instanceof Error`).
- Validation today: presence checks only.

## Target patterns (approved decisions)
- One `requireSession()` helper in `src/lib/` used by every protected route + `src/proxy.ts` optimistic redirect (D-006). Remove anonymous fallback.
- Validate bodies with a hand-written type guard returning 400 with field names (no new dependency unless approved).
- State-changing routes: same-origin/CSRF check + rate limit (P6).
- Shared links: expiry + revocation; access control decided in P4-06.
- Status codes: 400 invalid, 401 unauthenticated, 403 forbidden, 404 missing, 409 duplicate, 422 incompatible, 502 bad model output, 504 timeout, 500 unexpected (generic message, details in server log only after redaction).

## Don't
- Don't return secrets (current `GET /api/appconfig` returns `apiKey`, `appconfig/route.ts:7`).
- Don't call your own routes via `fetch` from the server.
- Don't build SQL with template strings; always `prepare(...).run(?, ?)`.
