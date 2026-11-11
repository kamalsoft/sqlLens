---
name: sqllens-refactor-rewrite
description: Use when changing the stored procedure refactor: /api/refactor, refactor prompts, model output validation, rewrite safety checks, index and view recommendations.
---
# Stored procedure refactor and rewrite safety

Last verified: `b90cda9` · Sources: `src/app/api/refactor/route.ts`, `src/lib/refactor.ts`, `src/lib/refactor-shared.ts`, `src/lib/rewrite-check.ts`, `src/lib/index-recommendations.ts`, `src/lib/sql-format.ts`

Related skills: `sqllens-transformers-local-inference` (model calls, JSON validation), `sqllens-api-route-patterns` (route shape), `sqllens-audit-recommendations` (where results are stored).

## Pipeline
1. `POST /api/refactor` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`). Calls `requireSession`, then `rateLimit("refactor:<sessionId>", 5, 60_000)` (429 when exceeded).
2. `buildRefactorPrompt(template, sql, instructions)`: the template must contain `{{STORED_PROCEDURE}}` and `{{USER_INSTRUCTIONS}}`. The prompt is capped at `MAX_REFACTOR_PROMPT_CHARS` = 60,000 (`RefactorTooLargeError`). User instructions are capped at `MAX_INSTRUCTIONS_LENGTH` = 2,000.
3. The model answers with a JSON block and a fenced SQL block. Parse the JSON and check it with `validateRefactor`. Failure is a 502, not a 500.
4. `finishRefactor(model, original, block, hitTokenLimit)` returns one of four `status` values:
   - `provided`: rewrite passed the checks; `refactoredSql` is formatted and `checks` are filled.
   - `none`: the model returned no SQL.
   - `unsafe`: the rewrite writes to or drops a permanent object the original did not touch (`statusDetail` names them). `refactoredSql` is empty.
   - `truncated`: the SQL block was cut off by the token limit. Empty output.
5. Static checks (`refactorChecks`): reads as T-SQL, every `@variable` and created `#temp` is declared, same parameters as the original, no `NOLOCK`, formatting did not change the SQL.

## Safety rules (do not weaken)
- The refactored SQL is **never executed** by this feature. Running it would need the execution safety controls and explicit authorization (AGENTS.md).
- `newWriteTargets` must stay in the pipeline. A rewrite may not add writes to tables the original did not write.
- Views (`verifyViewRecommendations`): at most 3 kept. A view must be one `SELECT`/`WITH` with no `;`, `@`, `#`, or `ORDER BY`, read only from tables the original uses. Its name must be a safe identifier. The DDL is built by the server.
- Index recommendations (`verifyIndexRecommendations`): at most 5, at most 6 key columns and 10 included columns. Table and columns must exist in the SQL. `buildCreateIndex` builds the DDL with bracket quoting.
- Every removed recommendation is added to `limitations` so the user sees what was dropped.
- Model output is untrusted. Keep it through `validateRefactor` and the checks above before it reaches the page.

## Formatting
- `formatTsql(sql)` returns `{ text, formatted }`. If formatting fails it returns the original text with `formatted: false`. Never let formatting change the SQL meaning.

## Types
- Put types the client needs in `refactor-shared.ts`. `refactor.ts` re-exports them, so `refactor.ts` imports stay valid.

## Verify
- Unit tests for `newWriteTargets` (INSERT, UPDATE, DELETE, MERGE, DROP; comments and string literals must not count), `missingDeclarations`, `procedureParameters`, `verifyViewRecommendations`, `verifyIndexRecommendations`, and `finishRefactor` for each status.
- Route tests: no session → 401; 6th request in a minute → 429; malformed model JSON → 502.
- `npm test`, `npm run typecheck`, `npm run build`.

## Don't
- Don't add a path that executes the rewrite.
- Don't let the model choose DDL text the server does not build or check.
- Don't return model output as HTML. Render it as text.
- Don't raise the prompt or instruction caps without measuring the model's context window (`sqllens-transformers-local-inference`).
