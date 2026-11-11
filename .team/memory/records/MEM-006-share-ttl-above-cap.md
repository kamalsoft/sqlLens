# MEM-006 Share TTL configurable above the 720-hour cap

- Kind: issue
- Status: fixed
- Date: 2026-10-25 · Commit: b90cda9
- Area: app config (`src/lib/app-config.ts`), share creation
- Owner: backend (review: security)
- Links: D-025 · P4-06

## Symptom
Security review (Low) found that the configured share TTL could be set to 8760 hours (one year), while the request-level limit is 720 hours.

## Micro detail
- Files: `src/lib/app-config.ts` (`shareTtlHours`), `src/app/api/audit/[id]/share/route.ts` (requested `ttlHours` is validated 1–720)
- Repro: set `shareTtlHours` to 8760 in appconfig and create a share without `ttlHours`

## Macro detail
- Share links grant access to stored results. A long TTL widens exposure.
- Config-level only.

## Root cause
Verified: the request validation capped the value, but the config path did not.

## Fix
`shareTtlHours` max is 720.

## Verification
- backend fix done; test `tests/unit/app-config-validation.test.ts` added.
- Log states 251 tests passing after the change.

## Prevention
Every limit enforced at the request must also be enforced at config load. See `sqllens-audit-recommendations`.
