# sql-engine — history

Append-only learnings (date, task ID, fact, evidence path:line). Scribe promotes durable facts into skills.

- 2026-10-24: role created (D-011). Baseline `22d84fa`.

## P2-01 / C17 / P4-04 (telemetry parsers, null-safe analyzer)
- Parsers: `src/lib/telemetry/{types,mssql,postgres}.ts`; fixtures in `tests/fixtures/telemetry/`. Do not parse STATISTICS IO with one regex of optional `(?:,...)?` groups: a greedy `[\d,]+` swallows the trailing comma and skips every optional group silently. Parse per-label instead.
- Postgres: first `Buffers:` line before `Planning:` is the cumulative root; CPU is always null. Postgres IO row still uses scanCount 1 when Buffers exist (type needs a number) -- a known approximation, revisit with C11 owner.
- `compareExecutions` now also returns `metrics`; `performanceGrade` can be null; throws on simulated vs real.
- sp-executor keeps `require('mssql'/'pg')` with a file-level eslint-disable until P2-02/P2-03.
- Driver error text is scrubbed of host/user/password/database before logging.

## P6-03b / P2-02..05 / P2-07 / P6-08 / C17 (mocked drivers only; no live DB)
- Layout: `src/lib/execution/{types,sql-scan,request,mssql,postgres}.ts`; `sp-executor.ts` is now a dispatcher + simulator; routes `api/execute` and `api/connections/test`. `src/types/drivers.d.ts` declares `mssql`/`pg` (neither ships types, no @types installed).
- mssql: pool max 1 so session `SET STATISTICS IO/TIME/XML ON` applies to the next request; batch runs in `sql.Transaction`, rollback in `finally`, swallowed if no tx. Timeout = own timer + driver `requestTimeout` (ETIMEOUT).
- pg 8.23 Client has no per-query cancel: cancel via second client `pg_cancel_backend(client.processID)`. SQLSTATE 57014 is both timeout and cancel, so disambiguate with local flags. `statement_timeout` set with `set_config(..., $1)` (bound) instead of `SET`.
- Batch guard: COMMIT/ROLLBACK (mssql) and tx-control leading keywords (pg) are rejected, since a batch that commits defeats the rollback. `maskSql` handles E'..\'..' escapes so a backslash cannot hide a COMMIT. Non-transactional side effects (DDL that autocommits in mssql, sequences, xp_cmdshell, linked servers) are NOT undone by rollback.
- pg procedure mode is CALL only (timing only, other metrics null); the C12 target has no function flag.
- Gotcha: the legacy UI sends trustServerCertificate=true, so legacy requests get the TLS warning by design.
