# security — history

Append-only learnings (date, task ID, fact, evidence path:line). Scribe promotes durable facts into skills.

- 2026-10-24: role created (D-011). Baseline `22d84fa`.

## 2026-10-24 W1 review (P6-01/02/03/04, P1-02/03/06): CHANGES REQUIRED
- Blocking: login rate-limit key from client-controlled X-Forwarded-For (request-guard.ts:32-35); bucket map clear() reset (request-guard.ts:13).
- Non-blocking: sanitizeNext tab/newline bypass (api-client.ts:17-21); timing on '!disabled' hashes (login/route.ts:32); no Host allowlist vs DNS rebinding (proxy.ts:21); redact regex gaps pwd/api_key/credential (redact.ts:1); downloadDirectory unconstrained + rm -rf of destination (app-config.ts:59, download/route.ts:156); download 500 leaks error.message (download/route.ts:178).
- Known gaps (P6-03b/c): execute, review, review/models, models/download, models/refresh unauthenticated.
- Verified OK: scrypt C2 params, timingSafeEqual, dummy hash, 256-bit tokens, expiry per lookup, server-side logout, cookie flags, admin script no echo/min 12/same DB dir, no apiKey in appconfig GET/file, HF_TOKEN env-only, parameterized SQL, migration 002 non-destructive via tracked runner.
