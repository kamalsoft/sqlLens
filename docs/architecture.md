# Architecture

## Application structure

One Next.js server process on the user's machine serves the pages and the API. Everything below is checked against the code (2026-11-13).

```text
src/
  proxy.ts            Runs before requests. API calls: allowed Host only, no cross-site writes.
                      Pages: redirect to /login when there is no session cookie.
  app/                Pages (Overview, Review, Execute & Audit SP, Compare, Refactor, Audit, Settings,
                      Manage Models, Help, Login, Share) and API routes under app/api/.
  instrumentation.ts  Retention: on server start and once a day.
  lib/
    sp-executor.ts    Runs a procedure or batch: SQL Server, PostgreSQL (API only; the UI offers
                      SQL Server and Simulation) or Simulation (no database, synthetic statistics).
    execution/        SQL Server (mssql) and PostgreSQL (pg) drivers.
    telemetry/        Parses SQL Server STATISTICS IO/TIME messages and PostgreSQL EXPLAIN output.
    audit-analyzer.ts Grade and prod-readiness verdict, computed by code from the measurements.
    inference.ts      Sends model work to the worker process; one run at a time, with a timeout.
    review-*, refactor*, compare, extract-json, index-recommendations, rewrite-check
                      Prompts and the checks on model output.
  db/                 SQLite access (better-sqlite3) and numbered migrations.
scripts/
  inference-worker.mjs  Separate Node process that loads ONNX models (Transformers.js) and generates.
  set-admin-password.ts Creates the admin login.
data/
  appconfig.json      Settings (read and saved by the Settings page).
  prompts/            Prompt templates (only .md files in this folder may be configured).
```

Outside the repository: the SQLite database (`SQLLENS_DB_DIR`, default `../../sqllens_db`: audit records, recommendation feedback, users, sessions), model files in `downloadDirectory` (Settings), and run logs in `audit_logs/` (`SQLLENS_AUDIT_LOG_DIR`), one file per execution.

## Runtime flow

1. The browser calls an API route. `src/proxy.ts` rejects an unknown `Host` or a cross-site write (403).
2. Every API route except `POST /api/auth/login` checks the session in the database (401 otherwise) and validates its input. Execute, catalog, connection-test, model, download, settings, share, feedback and delete routes apply a per-session rate limit (sign-in has its own limits); read routes and logout do not. Security headers come from `next.config.ts` for every response.
3. The route does its work:
   - **Execute:** runs Simulation, or SQL Server/PostgreSQL only when `allowLiveExecution` is on; captures STATISTICS IO/TIME and the XML plan (SQL Server, `SET STATISTICS XML ON`); the analyzer grades the measurements.
   - **Review, Compare, Refactor:** build a prompt from `data/prompts/` and send it to the model worker.
4. Model output is checked before it is returned: it must parse as the expected JSON; review table rows whose evidence is not quoted from the submitted SQL are dropped; index ideas must name tables and columns in the SQL; refactored SQL is checked for new write targets and undeclared variables. Model-written SQL is never executed.
5. Execute, Review, Compare and Refactor save an audit record owned by the session; Execute also writes a run log. Catalog lists, settings and downloads are not audit records.
6. Manage Models downloads repositories from Hugging Face into `downloadDirectory` (with `HF_TOKEN` when set). No other outside service is called.

## Model directory requirements

A usable model directory must include the model configuration and a compatible ONNX file, for example:

```text
<model-directory>/
  config.json
  tokenizer.json
  tokenizer_config.json
  onnx/
    model_quantized.onnx
```

Safetensors-only, GGUF-only, and incomplete directories must not be presented in the model dropdown.

## Configuration

The model location is controlled by:

```json
{
  "downloadDirectory": "~/dev/dbPro/sqlens/downloads/models"
}
```

Do not hard-code the model directory in application code.

## Database migrations

- Location: `src/db/migrations/NNN_name.sql` (name must match `^\d{3}_[a-z0-9_]+\.sql$`; each number used once).
- Applied at startup by `runMigrations` (`src/db/migrate.ts`, called from `src/db/index.ts`), in numeric order, each in its own `IMMEDIATE` transaction; a failure rolls back that file and throws with its name.
- Applied file names are recorded in `schema_migrations(id, applied_at)`; applied files are skipped, so parallel Next.js workers starting together apply each file once.
- `001_baseline.sql` uses `CREATE TABLE IF NOT EXISTS`, so it is a no-op on existing databases.
- Never edit an applied migration; add a new numbered file.
- Database directory: `SQLLENS_DB_DIR`, default `../../sqllens_db` (see [Configuration](configuration.md)).

## API response

Each route's request and response are in [api.md](api.md). For example, `POST /api/review` returns `{ id, recordNumber, model, schemaVersion, lowConfidence, schemaFallback?, promptPath, executionAuditId?, result }`; reviews are findings only (`rewrittenProcedure` is always empty; rewrites come from Refactor).

The client must render result fields individually or serialize the object with `JSON.stringify`; it must not render the complete result object directly as a React child.
