# Telemetry text formats (as matched by current code)

Source: `src/lib/sp-executor.ts:109-118,185-203,286-299,314-316` @ `22d84fa`.

SQL Server STATISTICS IO line (regex `:286`):
    Table 'Orders'. Scan count 1, logical reads 420, physical reads 3, read-ahead reads 0, lob logical reads 0, lob physical reads 0, lob read-ahead reads 0.

SQL Server STATISTICS TIME (regex `:296-299`):
    SQL Server parse and compile time:
       CPU time = 2 ms, elapsed time = 2 ms.
     SQL Server Execution Times:
       CPU time = 31 ms,  elapsed time = 40 ms.

PostgreSQL EXPLAIN (ANALYZE, BUFFERS) (regex `:314-316`):
    Buffers: shared hit=128
    Planning Time: 0.210 ms
    Execution Time: 3.402 ms

Real-server output beyond these shapes (newer SQL Server columns such as "page server reads", XML showplan) is `[UNVERIFIED]` — collect real samples only with user authorization and store them as test fixtures.
