# API Reference

All routes are local-only (D-008) and currently unauthenticated unless noted. There is no middleware, so no route is protected yet (Planned: P6-02/P6-03 for auth and route protection).

## Routes

| Method | Path | Purpose (current) | Auth (current) | Evidence |
| --- | --- | --- | --- | --- |
| GET | `/api/analysis` | Returns analysis stats. Currently a hardcoded empty array (mock). Planned: P1-04. | none | `src/app/api/analysis/route.ts:4-12` |
| POST | `/api/analysis` | Not working: calls a relative `fetch("/api/analysis")` on the server. Planned: removed by P1-04. | none | `src/app/api/analysis/route.ts:43` |
| GET | `/api/appconfig` | Returns the application config. The response includes the `apiKey` field. Planned: removed by P1-02. | none | `src/app/api/appconfig/route.ts:6-10` |
| PUT | `/api/appconfig` | Saves config. Omitted fields reset to defaults; no type validation (400 only on JSON parse or write failure). Planned: P1-02. | none | `src/app/api/appconfig/route.ts:12-25` |
| GET | `/api/audit` | Lists audit records for the session user. Each item includes `shared` (boolean) and `shareExpiresAt` (ISO string or null); an active share means unrevoked, unexpired, non-NULL expiry (legacy NULL expiry is not shared). `hasShare` is kept as an alias. The token is never returned. `GET /api/audit/[id]` returns the same fields. Empty list when there is no cookie. No UI caller. | cookie (`session_token`) | `src/app/api/audit/route.ts:7-8` |
| POST | `/api/auth/login` | Mock login: any username is created on first use; password is ignored. | n/a | `src/app/api/auth/login/route.ts:11-19` |
| POST | `/api/auth/logout` | Ends the session. | cookie | `src/app/api/auth/logout/route.ts:10-13` |
| GET | `/api/auth/me` | Returns the user for the session cookie. | cookie | `src/app/api/auth/me/route.ts:14-31` |
| POST | `/api/compare` | Model-based compare (local Transformers.js). Body: `modelId` plus either `{originalAuditId, optimizedAuditId}` (owner-only EXECUTE/EXECUTE_COMPARE audits; `compareExecutions` metric deltas are injected into the prompt and stored) or `{original, optimized}` SP texts (metrics `null`). Simulated vs real audits are rejected (400). Result validated (`winner`, `summary`, `differences`, `risks`, `confidence`) and persisted as `COMPARE` with `schema_version=compare-v1`, response `{result, metrics, originalAuditId, optimizedAuditId}`. Errors as review (404/422/429/502/504); 5/min per session. | session | `src/app/api/compare/route.ts`, `src/lib/compare.ts` |
| POST | `/api/execute` | Executes the submitted procedure(s) on the engine in the request body (`mssql`, `postgres`, or `simulation`) and writes audit records. Planned: P2-05 (live-execution gate and auth). | cookie, falls back to `anonymous` | `src/app/api/execute/route.ts:11-12`, `:45-48`, `:53` |
| POST | `/api/models/download` | Downloads a Hugging Face repository into the model directory. Uses the token from `apiKey` in app config. Planned: P1-03 (`HF_TOKEN`). | none | `src/app/api/models/download/route.ts:209-305`, token `:236` |
| GET | `/api/models/refresh` | Scans the filesystem and returns installed-model status with a hardcoded catalog. | none | `src/app/api/models/refresh/route.ts:21-70`, `:110-166` |
| GET | `/api/models/status` | Session required. Installed models with `{ id, name, compatible, parameterEstimate, small, loaded, loading, lastError }`. | none | `src/app/api/models/status/route.ts` |
| GET | `/api/review/models` | Lists installed models `{ id, name, directory, compatible, parameterEstimate, small }` (via `getInstalledModels`, `src/lib/installed-models.ts`). `parameterEstimate` is layers*(4*h^2+3*h*intermediate)+vocab*h from the model's `config.json` (`null` when unknown); `small` is true only when the estimate is known and under 1B (`src/lib/model-size.ts`). | none | `src/app/api/review/models/route.ts:6-9` |
| POST | `/api/refactor` | Generates an optimized version of a stored procedure or query with a local model (never executed). Body: `modelId`, `sql` (must pass `looksLikeSql`), optional `instructions` (≤ 2000 chars; passed inside `<user_instructions>` with tag-like text neutralised; cannot override the prompt's safety rules). Prompt `data/prompts/refactor.md` (or `prompt.refactor` in app config). The model returns JSON (`summary`, `changes`, `indexRecommendations`, `viewRecommendations`, `otherRecommendations`, `limitations`) then plain T-SQL in `<rewritten_procedure>`. Response `result` adds `status` (`provided`/`none`/`unsafe`/`truncated`), `refactoredSql` (formatted by `src/lib/sql-format.ts`; left unformatted if formatting would change anything but whitespace or keyword case), `formatted`, and `checks` (reads as T-SQL, every variable/temp table declared, same parameters, no NOLOCK, formatted). Indexes are verified as for reviews; a view is kept only when its name is a safe identifier and its definition is one read-only `SELECT` over tables in the SQL, with a generated `CREATE VIEW`. SQL that writes to permanent tables the original does not is removed (`unsafe`). Persisted as `REFACTOR` with `schema_version=refactor-v1`. Errors as review (400/401/404/422/429/502 with `details.responseText`/504); 5/min per session. | session | `src/app/api/refactor/route.ts`, `src/lib/refactor.ts` |
| POST | `/api/review` | Runs a stored-procedure review with Transformers.js. See below. | none | `src/app/api/review/route.ts:2`, `:94`, `:194-199` |
| GET | `/api/share/[token]` | Returns a shared audit record (compare or execute result) by token; every record gets a token automatically. No expiry yet. Planned: P4-06 (access control and expiry). | none | `src/app/api/share/[token]/route.ts:10` |

Pages: `/`, `/review`, `/execute`, `/compare`, `/refactor`, `/manage-models`, `/share/[token]`. `/settings` exists but is not in the sidebar (`src/components/AppShell.tsx:11`).

## `POST /api/review`

Request:

```json
{
  "modelId": "owner/model",
  "sql": "CREATE PROCEDURE dbo.Test AS SELECT 1;"
}
```

Both fields are required. `sql` is trimmed before use (`src/app/api/review/route.ts:194`). Planned: P1-06 adds input length and NUL-byte validation.

Success response (`200`): `{ "model": "<id>", "promptPath": "<path>", "result": <object> }` (`src/app/api/review/route.ts:270-274`). Planned: P3-01 (versioned review schema; `schemaVersion`).

Status codes:

- `200`: analysis completed (`route.ts:270`).
- `400`: `modelId` or `sql` is missing (`route.ts:196-199`).
- `404`: the model is not installed (`route.ts:206-210`).
- `422`: the model is installed but not compatible with local Transformers.js (`route.ts:213-220`).
- `502`: the model returned no text (`route.ts:258-264`), or its output could not be parsed as JSON; the body includes a `details` object (`route.ts:276-289`).
- `500`: unexpected server error (`route.ts:294-302`).

## Review and model route behavior (P6-03c, P3-02, P3-06)

All `/api/review/**` and `/api/models/**` handlers require a session (401). `POST /api/review` is limited to 5 requests per minute per session and `POST /api/models/download` to 5 per minute (429). Review errors: 400 (invalid SQL, text that does not look like SQL — `looksLikeSql` in `src/lib/validation/sql-input.ts` requires a recognisable statement such as `CREATE PROCEDURE`, `SELECT … FROM`, `SET NOCOUNT`, `EXEC schema.proc`; `/api/compare` applies the same check to `original` and `optimized` —, `schemaVersion`, or prompt larger than the context window), 404 (model not installed), 422 (incompatible model), 429 (rate limit, or another inference is running), 502 (model output is not valid JSON for the schema; when the outer JSON object never closes and the new-token budget was used up, the error names the `maxNewTokens` limit (or says the model was repeating itself when the output loops); when the model stopped on its own with only a final string value open, that string is closed and the review is validated normally; `details.responseText` carries the raw output, up to 50,000 characters), 504 (inference exceeded `inferenceTimeoutMs`; raise it in Settings or shorten the SQL). 500 returns `{ "error": "Internal error" }`. For v2 results, rows in `findingsTable`, `performanceTable` and `securityTable` whose `evidence` is not quoted from the submitted SQL (whitespace and case ignored; `"not observed"` is kept) are removed, and a `limitations` entry states how many. The prompts ask for the rewrite as plain T-SQL after the JSON, between `<rewritten_procedure>` and `</rewritten_procedure>`, so it needs no JSON escaping; the route parses only the JSON before the block, takes the block as `rewrittenProcedure` (code fences stripped), and still accepts a rewrite inside the JSON. Missing commas between array items or objects are repaired. Both schema versions include `rewriteNotes` (`[]` when absent) and a server-set `rewriteStatus`: `provided`, `none`, `invalid` (the rewrite did not look like SQL, or uses `@variables` it never declares or `#temp` tables the original creates but it does not; removed, with `rewriteDetail` naming them), `unsafe` (the rewrite INSERTs, UPDATEs, DELETEs, MERGEs, TRUNCATEs or DROPs a permanent object the original never writes to; it is removed and `rewriteDetail` names the objects — see `src/lib/rewrite-check.ts`) or `truncated` (the new-token limit cut off only the final `rewrittenProcedure`; the rest of the review is kept and the partial SQL discarded). In v2, a malformed table row is dropped and counted in `limitations` instead of failing the review; enum values are normalised (`"Error Handling"` → `error_handling`), missing tables default to `[]`, and evidence abbreviated with `...` is kept when every fragment appears in the SQL in order. For index rows, every column must be qualified with that table's alias or name, or used unqualified without being an `AS` alias; comments are ignored. Both schema versions include `indexRecommendations` (`[]` when absent): each row has `table`, `keyColumns`, `includeColumns`, `reason`, `evidence`. The route keeps a row only when the table is referenced after `FROM`/`JOIN`/`UPDATE`/`INTO`/`MERGE` (not an alias, CTE, `#temp` or `@table`) and every column appears in the submitted SQL, then adds a server-generated `createStatement` (`CREATE NONCLUSTERED INDEX …`, identifiers bracket-escaped); model-written DDL is never returned. At most 5 rows, 6 key and 10 include columns; for v2, a `limitations` entry counts removed rows. When `schemaVersion` is omitted, `small` models use `v1` (D-035) and others use `v2`; an explicit `v2` is honoured. The review response includes `lowConfidence: boolean` (true for small models). If a `v2` request (without telemetry) returns valid `v1` JSON, the review is accepted as `schemaVersion: "v1"` with `schemaFallback: true` and `lowConfidence: true`. There is no mock fallback. `SQLLENS_FAKE_INFERENCE=1` returns canned JSON outside production only.

## Audit storage note (D-028 scope)

The SQLite audit record written for an execution stores the batch SQL text regardless of the `logSqlText` setting. `logSqlText=false` only omits the SQL from the on-disk text audit log (a SHA-256 and length are written instead). Treat the SQLite audit database as containing submitted SQL.

## Review persistence and telemetry (P4-01)

`POST /api/review` persists each successful result as a `REVIEW` audit (`schema_version`, `model_id`) and returns its `id` and `recordNumber`. Optional `executionAuditId` (the caller's own EXECUTE/EXECUTE_COMPARE audit; 404 otherwise; requires `schemaVersion` v2) injects normalized telemetry (no raw output) using `data/prompts/review-with-telemetry.md`; the response echoes `executionAuditId`.

`POST /api/models/download` only deletes directories that resolve inside the configured download root; an unsafe `modelId` returns 400.

## MSSQL batch restrictions (D-034)

In MSSQL batch mode the request is rejected with 400 if the SQL (after comments and quoted text are masked) contains `EXEC`, `EXECUTE` or `sp_executesql` (including `EXEC(` and `[sp_executesql]`): "use procedure mode to run procedures". `COMMIT` and `ROLLBACK` remain rejected. Batches also run inside nested transactions (`@@TRANCOUNT` is 2 before the user SQL); if `@@TRANCOUNT` is below 2 afterwards, execution fails with an error that a COMMIT/ROLLBACK escaped the batch, and the remaining transaction is rolled back. Procedure mode is unchanged.
