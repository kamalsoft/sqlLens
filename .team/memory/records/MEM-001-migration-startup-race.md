# MEM-001 Concurrent startup migration race

- Kind: issue
- Status: verified
- Date: 2026-10-24 · Commit: 22d84fa (fix landed after this; re-check current hash)
- Area: src/db/migrate.ts
- Owner: backend (review: lead)
- Links: D-020 · P0-03 · src/db/migrations

## Symptom
Two Next.js workers started at the same time both tried to apply the same migration. One failed with a primary key conflict on `schema_migrations`.

## Micro detail
- Files: `src/db/migrate.ts` (`runMigrations`)
- Symbols: `schema_migrations`, `db.transaction(...).immediate()`
- Environment: Next dev/start with more than one worker, same DB file
- Repro: start two processes against an empty DB at once (`SQLLENS_DB_DIR` pointing to the same folder)

## Macro detail
- Affects startup of every process that opens the DB (`src/db/index.ts` runs migrations at import time)
- No data loss; startup fails for one worker
- Cross-cutting: any future migration hits the same path

## Root cause
Verified. The check "is this file applied?" ran outside the write transaction, so two processes could both see it unapplied.

## Fix
- Run each migration in `BEGIN IMMEDIATE` and re-check `schema_migrations` inside the transaction.
- Reject duplicate 3-digit prefixes before running anything.
- Reject file names that do not match `^\d{3}_[a-z0-9_]+\.sql$`.

## Verification
- P0-03 lead review: round 1 CHANGES REQUIRED, round 2 PASS.
- 11/11 migration tests passing at the time of review.
- Real DB not touched by the review. First real-DB run was waiting for user approval (AC4).

## Prevention
Keep the concurrency test in the migration test suite. See `sqllens-database-migrations`.
