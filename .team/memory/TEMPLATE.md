# MEM-### <short title>

- Kind: issue | requirement | fix | rule
- Status: open | workaround | fixed | verified | superseded
- Date: YYYY-MM-DD · Commit: <short hash where observed>
- Area: <module, e.g. src/db/migrate.ts>
- Owner: <agent or person, by role>
- Links: D-### · P#-## · MEM-### (only IDs that exist)

## Symptom
Exact error text, HTTP status, or observed behaviour. Quote logs in a code block, redacted.

## Micro detail
- Files and lines: `path:line` (re-check the line before relying on it; lines drift)
- Symbols: function, route, or table names
- Environment: Node, OS, DB file, env flags such as `SQLLENS_TRUST_PROXY`
- Repro: numbered steps or one command

## Macro detail
- Modules and contracts affected (routes, schema, prompts, UI pages)
- Data impact: rows, migrations, shared links, stored results
- Scope: one file, one module, or cross-cutting

## Root cause
Label it **verified** (reproduced and explained) or **suspected** (not yet confirmed). Name what ruled out the other causes.

## Fix
What changed, which files, and why this fix over the alternatives. Link the commit or PR.

## Verification
The exact commands and their results, for example `npm test` → 251 passed.

## Prevention
One line: the test, check, or rule that stops it coming back.
