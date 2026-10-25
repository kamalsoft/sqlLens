---
name: sqllens-sql-execution-mssql-pg
description: Use when changing how SQLLens executes stored procedures against SQL Server (mssql) or PostgreSQL (pg), simulation mode, connection testing, timeouts, cancellation, or parameter handling.
---
# SQL execution (mssql 12.7.0, pg 8.23.0)

Last verified: `22d84fa` · Sources: `src/lib/sp-executor.ts`, `src/app/api/execute/route.ts`, `.team/decisions.md` D-004/D-005

## Current code
- `executeSP(sp, label, config)` (`sp-executor.ts:342`) dispatches on `config.engine`: `mssql` | `postgres` | `simulation`.
- mssql: `mssql.connect({... trustServerCertificate: ?? true})` (`:229-236`), wraps raw text with `SET STATISTICS IO/TIME ON` (`:238-244`), reads stats from `recordsets` (`:250`). `[UNVERIFIED]` mssql delivers STATISTICS text as `info` events on the request — current code likely captures nothing.
- pg: `new pg.Client` without `ssl` (`:263-269`), runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sp}` (`:272`) — `EXPLAIN ANALYZE` executes the statement; not valid for `CREATE PROCEDURE`/`CALL` `[UNVERIFIED]`.
- Simulation: random metrics from regex heuristics (`:138-215`).
- No timeout, no cancellation, no connection-test endpoint. Password arrives in request body; not persisted (`execute/route.ts:88` stores engine only).

## Approved policy
- D-005: default `EXEC <schema.proc>` with typed, bound parameters (mssql `request.input(name, type, value)`; pg `$1..$n`). Arbitrary batch only inside a transaction that is always rolled back.
- D-004: simulation stays, results labeled `simulated: true`, excluded from compare and analysis stats; real execution only for an authenticated user with explicit opt-in.
- D-008: local deployment; still default TLS on (`trustServerCertificate: false`, pg `ssl` configurable) — confirm in task.

## Do
- Validate identifiers (proc name) against a strict pattern; never string-concatenate values.
- Set mssql `requestTimeout` / pg `statement_timeout`; support cancel via `AbortSignal` → `request.cancel()` / `pg_cancel_backend`.
- Close pools/clients in `finally`.

## Don't
- Never connect to a real DB in tests or agent runs without user authorization.
- Never log or persist passwords or connection strings (see sqllens-security-redaction).
- Don't use `require('mssql')` — static import (lint).
