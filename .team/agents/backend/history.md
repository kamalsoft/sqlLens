# backend — history

Append-only learnings (date, task ID, fact, evidence path:line). Scribe promotes durable facts into skills.

- 2026-10-24: role created (D-011). Baseline `22d84fa`.
- 2026-10-24: P0-03: migrations run via src/db/migrate.ts (runMigrations(db, dir)); tests must never import src/db/index.ts (opens real DB at import); SQLLENS_DB_DIR overrides DB dir. Evidence src/db/index.ts, tests/unit/db-migrate.test.ts.

## 2026-10-24 W1 (P6-01/02/03, P1-02, P1-06)
- Migration 002_auth.sql adds sessions.expires_at, deactivates sessions, disables non-scrypt users. It breaks tests/unit/db-migrate.test.ts, which hardcodes ['001_baseline.sql'] (qa owns it).
- tsconfig forbids `.ts` import extensions (TS5097), but node strip-types needs them: scripts/set-admin-password.ts uses `// @ts-expect-error TS5097`.
- app-config accepts SQLLENS_CONFIG_PATH so tests never write data/appconfig.json. PUT ignores unknown keys (legacy apiKey from the settings page) rather than 400.
- Proxy CSRF: a request with no Origin header passes (non-browser clients); a mismatched Origin gets 403.
- rateLimit is a token bucket; use resetRateLimits() in tests.
- W1 fixes: rate limit keys ignore XFF unless SQLLENS_TRUST_PROXY=1; proxy has host allowlist; migration 003 added (audit_requests metadata); audit-repo is the only audit writer for compare. execute/route.ts still inserts directly (sql-engine must move to insertAudit).
- 004/005 added: feedback keys are '<table>:<index>' (v2) / 'issues:<index>' (v1), client-supplied. Share: NULL share_expires_at = expired (legacy tokens 410).
