---
name: sqllens-telemetry-parsing
description: Use when parsing or normalizing SQL Server STATISTICS IO/TIME output, execution plans, or PostgreSQL EXPLAIN ANALYZE text into SQLLens ExecutionStats, or when writing parser tests.
---
# Telemetry parsing

Last verified: `22d84fa` · Sources: `src/lib/sp-executor.ts:32-63,284-336`, `src/lib/audit-analyzer.ts`
Detail: `references/formats.md`

## Types (`sp-executor.ts`)
- `StatisticsIORow` {table, scanCount, logicalReads, physicalReads, readAheadReads, lobLogicalReads, lobPhysicalReads, lobReadAheadReads} (`:32-41`)
- `ExecutionStats` {parseAndCompileTime, parseAndCompileCpu, executionTime, executionCpu, totalElapsedMs, io[], messages[], rawOutput} (`:43-52`)

## Current parsers
- `parseRawStatisticsOutput` (`:284`): regex for `Table 'x'. Scan count N, logical reads N, physical reads N, read-ahead reads N`; LOB fields hardcoded 0; first `CPU time = … elapsed time = …` treated as parse/compile.
- `parsePostgresPlan` (`:313`): `Execution Time`, `Planning Time`, first `Buffers: shared hit=`; CPU is **fabricated** as `execMs*0.8` (`:326`); single pseudo-table `postgres_query`.
- Not exported → untestable today (export or move to `src/lib/telemetry/`).

## Consumers
- `analyzeExecution` (`audit-analyzer.ts:56`) grades A–F from stats (`:36`); `compareExecutions` (`:154`) gives before/after deltas.

## Do
- Pure functions, string in → typed object out; export them; unit-test with fixture text.
- Multiple statements: sum per table and keep per-statement rows.
- Unknown values → `null` and surface "not captured" in UI.

## Don't
- Don't invent or estimate metrics (remove `*0.8`).
- Don't parse locale-formatted numbers (e.g. `1,234`) without handling the comma `[UNVERIFIED: depends on server locale]`.
