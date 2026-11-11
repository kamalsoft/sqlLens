# MEM-005 `improvementPercent` null shown as 0%

- Kind: issue
- Status: verified
- Date: 2026-10-25 · Commit: b90cda9
- Area: execute page (`src/app/execute`), telemetry comparison values
- Owner: frontend (review: sql-engine)
- Links: P2-08

## Symptom
When an improvement could not be calculated, the execute page showed `0%`. A null parse or execution time also showed as a number.

## Micro detail
- Files: execute page under `src/app/execute/`, target editor component
- Repro: a run where the baseline metric is missing, so the comparison is null

## Macro detail
- User-facing: a missing measurement looked like "no change", which is misleading.
- Local to the execute page.

## Root cause
Verified in review: null values were coerced to 0 before display.

## Fix
- Null improvement is hidden.
- Null milliseconds show "Not captured".
- Port validated to 1–65535.
- Warnings shown in their own box.
- Two tests added on top of the first set of four.

## Verification
- Frontend P2-08 review fixes: 251 tests passing at the time (log, 2026-10-25).
- sql-engine re-review was requested; result not in the log.

## Prevention
Missing metric → "Not captured", never 0. See `sqllens-frontend-ui` and `sqllens-audit-recommendations`.
