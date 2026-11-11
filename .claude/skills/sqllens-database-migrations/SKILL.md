---
name: sqllens-database-migrations
description: Use when adding, changing, or reviewing a SQLite schema change, a numbered migration in src/db/migrations, the migration runner, the DB file location, or any code that opens the database at startup.
---
# Database migrations (SQLite via better-sqlite3)

Last verified: `b90cda9` · Sources: `src/db/index.ts`, `src/db/migrate.ts`, `src/db/migrations/*.sql`, `src/db/audit-repo.ts`, `.team/decisions.md` (D-002, D-002b, D-020, D-022)

## How it works today
- `src/db/index.ts` opens `sqllens.db` at import time. Directory: `SQLLENS_DB_DIR` if set, else `../../sqllens_db` relative to `process.cwd()` (D-022). Keep the DB outside the repo.
- `runMigrations(db, dir)` (`src/db/migrate.ts`) runs on every startup:
  1. Creates `schema_migrations(id, applied_at)`.
  2. Rejects any file not matching `^\d{3}_[a-z0-9_]+\.sql$`, and any duplicate 3-digit prefix. Both throw before anything runs.
  3. Sorts by number, then runs each unapplied file in its own `BEGIN IMMEDIATE` transaction. It re-checks `schema_migrations` inside the transaction, so two processes cannot apply the same file twice.
  4. A failing file throws `Migration failed: <file>: <message>`. Startup stops.
- Applied files are recorded by file name. Editing an applied file does nothing on databases that already ran it.
- Current files: `001_baseline`, `002_auth` (session expiry, disables legacy password hashes), `003_execution_metadata`, `004_recommendation_feedback`, `005_share` (share expiry and revocation).

## Writing a migration
- Name: next free number, `NNN_snake_case.sql`. Put one header comment on top with the task ID and what changed (existing files do this, e.g. `-- P4-06: ...`).
- Additive by default: `ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`. State "no rows deleted" when true (002, 003 do this).
- Nullable or defaulted new columns, so existing rows stay valid. Legacy rows that need a meaning must get an explicit rule, as `share_expires_at` NULL = expired in 005.
- SQLite cannot change `PRAGMA foreign_keys` inside a transaction, and the runner wraps each file in one. Don't put PRAGMAs in a migration.
- Dropping or renaming a column or table: use the rebuild pattern (create new table, copy, drop old, rename). Confirm with the user first. It is hard to undo and needs a backup.
- Never change an applied file. Write a new migration instead.
- Never put secrets, tokens, or real user data into a migration file.

## Code that touches the schema
- Queries use prepared statements with `?` placeholders. No string-built SQL (`src/db/audit-repo.ts` is the reference).
- Keep typed row shapes next to the query, as `audit-repo.ts` does, and map nullable columns explicitly.

## Before changing a real database
1. Stop the dev server.
2. Copy `sqllens.db` (and its `-wal`/`-shm` files if present) to a backup path outside the repo.
3. Start the app once, then check `SELECT id FROM schema_migrations;`.

## Verify
- Add a test that runs `runMigrations` on `new Database(':memory:')` twice: the second call must return `[]`.
- A new migration needs a test that runs it on a DB that already has the previous migrations applied.
- `npm run typecheck`, `npm test`, `npm run build`.

## Don't
- Don't run migrations by hand against the user's DB without a backup and approval.
- Don't add a second migration mechanism (npm script or ORM). D-020 chose the startup runner.
- Don't use `DROP`/`DELETE` on user data in a migration without explicit approval.
- Auth or session tables: also follow `sqllens-auth-sessions` and get Security sign-off (CLAUDE.md).
