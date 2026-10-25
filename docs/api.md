# API Reference

All routes are local-only (D-008) and currently unauthenticated unless noted. There is no middleware, so no route is protected yet (Planned: P6-02/P6-03 for auth and route protection).

## Routes

| Method | Path | Purpose (current) | Auth (current) | Evidence |
| --- | --- | --- | --- | --- |
| GET | `/api/analysis` | Returns analysis stats. Currently a hardcoded empty array (mock). Planned: P1-04. | none | `src/app/api/analysis/route.ts:4-12` |
| POST | `/api/analysis` | Not working: calls a relative `fetch("/api/analysis")` on the server. Planned: removed by P1-04. | none | `src/app/api/analysis/route.ts:43` |
| GET | `/api/appconfig` | Returns the application config. The response includes the `apiKey` field. Planned: removed by P1-02. | none | `src/app/api/appconfig/route.ts:6-10` |
| PUT | `/api/appconfig` | Saves config. Omitted fields reset to defaults; no type validation (400 only on JSON parse or write failure). Planned: P1-02. | none | `src/app/api/appconfig/route.ts:12-25` |
| GET | `/api/audit` | Lists audit records for the session user. Empty list when there is no cookie. No UI caller. | cookie (`session_token`) | `src/app/api/audit/route.ts:7-8` |
| POST | `/api/auth/login` | Mock login: any username is created on first use; password is ignored. | n/a | `src/app/api/auth/login/route.ts:11-19` |
| POST | `/api/auth/logout` | Ends the session. | cookie | `src/app/api/auth/logout/route.ts:10-13` |
| GET | `/api/auth/me` | Returns the user for the session cookie. | cookie | `src/app/api/auth/me/route.ts:14-31` |
| POST | `/api/compare` | Compares procedures with regex heuristics (mock AI); result is persisted. Planned: P4-02 (model-based compare). | cookie, falls back to `anonymous` | `src/app/api/compare/route.ts:25`, `src/lib/ai-transformer.ts:175-178` |
| POST | `/api/execute` | Executes the submitted procedure(s) on the engine in the request body (`mssql`, `postgres`, or `simulation`) and writes audit records. Planned: P2-05 (live-execution gate and auth). | cookie, falls back to `anonymous` | `src/app/api/execute/route.ts:11-12`, `:45-48`, `:53` |
| POST | `/api/models/download` | Downloads a Hugging Face repository into the model directory. Uses the token from `apiKey` in app config. Planned: P1-03 (`HF_TOKEN`). | none | `src/app/api/models/download/route.ts:209-305`, token `:236` |
| GET | `/api/models/refresh` | Scans the filesystem and returns installed-model status with a hardcoded catalog. | none | `src/app/api/models/refresh/route.ts:21-70`, `:110-166` |
| GET | `/api/models/status` | Session required. Installed models with `{ id, name, compatible, loaded, loading, lastError }`. | none | `src/app/api/models/status/route.ts` |
| GET | `/api/review/models` | Lists installed models (via `getInstalledModels`, `src/lib/installed-models.ts`). | none | `src/app/api/review/models/route.ts:6-9` |
| POST | `/api/review` | Runs a stored-procedure review with Transformers.js. See below. | none | `src/app/api/review/route.ts:2`, `:94`, `:194-199` |
| GET | `/api/share/[token]` | Returns a shared audit record (compare or execute result) by token; every record gets a token automatically. No expiry yet. Planned: P4-06 (access control and expiry). | none | `src/app/api/share/[token]/route.ts:10` |

Pages: `/`, `/review`, `/execute`, `/compare`, `/manage-models`, `/share/[token]`. `/settings` exists but is not in the sidebar (`src/components/AppShell.tsx:11`).

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

All `/api/review/**` and `/api/models/**` handlers require a session (401). `POST /api/review` is limited to 5 requests per minute per session and `POST /api/models/download` to 5 per minute (429). Review errors: 400 (invalid SQL, `schemaVersion`, or prompt larger than the context window), 404 (model not installed), 422 (incompatible model), 429 (rate limit, or another inference is running), 502 (model output is not valid JSON for the schema), 504 (inference exceeded `inferenceTimeoutMs`; raise it in Settings or shorten the SQL). 500 returns `{ "error": "Internal error" }`. There is no mock fallback. `SQLLENS_FAKE_INFERENCE=1` returns canned JSON outside production only.
