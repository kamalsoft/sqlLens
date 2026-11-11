# MEM-004 MSSQL batch can COMMIT via EXEC / sp_executesql

- Kind: issue
- Status: open
- Date: 2026-10-25 · Commit: b90cda9
- Area: src/lib/sp-executor.ts (MSSQL execution)
- Owner: sql-engine (review: security)
- Links: D-034 (approved as C) · D-005 · D-004

## Symptom
Security review (Medium) found that a batch sent to SQL Server can still COMMIT a transaction started elsewhere, by wrapping the statement in `EXEC` or `sp_executesql`. The execution path was meant to roll back.

## Micro detail
- Files: `src/lib/sp-executor.ts`
- Symbols: MSSQL batch execution path
- Repro: a batch whose body is `EXEC('COMMIT')` or `EXEC sp_executesql N'COMMIT'` after a `BEGIN TRAN`

## Macro detail
- Affects the safe execution model (D-005): execution must not persist changes it was supposed to roll back.
- Cross-cutting for every SQL Server run.

## Root cause
Suspected from the security finding. Not yet reproduced in a test.

## Fix
Decided: D-034 = C. Block `EXEC` and `sp_executesql` in MSSQL batches, and check for nested `BEGIN TRAN` / `@@TRANCOUNT`. Implementation status is not confirmed in the log.

## Verification
Not verified. Next step: add a test that the blocked forms are rejected, then re-run the security review on this path.

## Prevention
Keep the rule in `sqllens-sql-execution-mssql-pg`. Any new execution path needs the same check.
