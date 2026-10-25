---
name: sqllens-security-redaction
description: Use when code handles credentials, HF tokens, DB passwords, session tokens, stored procedure text in logs, share links, TLS settings, or when performing a security review in SQLLens.
---
# Security and redaction

Last verified: `22d84fa` · Sources: discovery §6 (F6.x), `.gitignore`, `AGENTS.md`

## Known exposures (fix via plan tasks)
- `GET /api/appconfig` returns `apiKey` (`appconfig/route.ts:7`); `data/appconfig.json` is tracked (value currently empty).
- Login creates any user, ignores password, hash `'simulated_hash'` (`auth/login/route.ts:11-19`); sessions never expire.
- Share links public, no expiry (`share/[token]/route.ts:10`); a token is minted for every record.
- `audit_logs/*.txt` store full SP source (`sp-executor.ts:105-106`) — now git-ignored.
- `trustServerCertificate` defaults true (`sp-executor.ts:235`); pg has no `ssl` (`:263-269`).
- Raw `error.message` returned to clients in most routes.

## Rules
- Secrets only server-side: `HF_TOKEN` env (D-007); DB passwords live in request memory only, never persisted/logged.
- Passwords: `crypto.scrypt` + per-user random salt + `timingSafeEqual` (D-006).
- Session cookie: httpOnly, `sameSite: "lax"` or stricter, `secure` in production, server-side expiry.
- Redact before logging: connection objects, `password`, `token`, `Authorization`, `HF_TOKEN`; log SQL as hash + length unless the user opted in.
- Never print secret values; never read `keys.md` or `.env*`.

## Review checklist (security role)
1. No secret in response, log, or tracked file. 2. Parameterized SQL only. 3. D-005 execution model enforced. 4. TLS on by default for remote SQL. 5. CSRF + rate limit on state-changing routes. 6. Share expiry + access control. 7. Errors generic to client.
