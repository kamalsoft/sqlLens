# P0-03 docs draft — APPLIED 2026-10-24 (user: "1, 2, 3")

## docs/configuration.md (add to the environment variables section)
```diff
+| `SQLLENS_DB_DIR` | Directory holding `sqllens.db`. Created if missing. Default: `../../sqllens_db` relative to the process working directory. |
```

## docs/architecture.md (add under persistence)
```diff
+### Database migrations
+- Location: `src/db/migrations/NNN_name.sql` (name must match `^\d{3}_[a-z0-9_]+\.sql$`).
+- Applied at startup by `runMigrations` (`src/db/migrate.ts`), in numeric order, each in its own transaction; a failure rolls back that file and throws with its name.
+- Applied IDs (file names) are recorded in `schema_migrations(id, applied_at)`; applied files are skipped.
+- `001_baseline.sql` uses `CREATE TABLE IF NOT EXISTS`, so it is a no-op on existing databases.
+- Never edit an applied migration; add a new numbered file.
```
