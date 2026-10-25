# P0-04 docs draft — APPLIED 2026-10-24 (user: "1, 2, 3")

Lead review 2026-10-24: PASS after edits (removed a stray drafting note in 1d, corrected the `/api/share` purpose, dropped 3b, fixed changelog script refs).

Baseline: `22d84fa` plus working tree. Every line number below was re-checked at drafting time.
Note: `src/db/index.ts` is being edited by P0-03 (uncommitted). Baseline DB path is `src/db/index.ts:7` at `HEAD`; do not document the working-tree `SQLLENS_DB_DIR` override until P0-03 is complete.

## Discovery §8 row status

| §8 row | Status in this draft |
|---|---|
| README `app/page.tsx` (`:23`) | Resolved: section 1a (line removed; Geist paragraph also removed, `rg "Geist|next/font" src` returns no matches). |
| README Python HF `transformers` (`:34`) | Resolved: section 1c. |
| README store "SQLite / Audit Logs" (`:58`) + `prisma.config.ts` | Partly resolved: section 1g fixes the label. `prisma.config.ts` exists at repo root, but README does not mention Prisma. No owner task found in `docs/team/plan.md`; lead must decide whether to remove the file (not a docs change). |
| README `.onnx` missing (`:286-291`) | Resolved: section 1e. |
| README local path (`:241`) | Resolved: section 1f. |
| README Vercel (`:140-144`) | Resolved: section 1b (D-008). |
| `docs/api.md:3` `GET /api/models` | Resolved: section 2. |
| `docs/configuration.md:13` corrupted, token source | Resolved: section 3. |
| `docs/configuration.md:14` "Do not execute submitted SQL" | Resolved: section 3 (Planned: P2-05). |
| `docs/architecture.md:65-80` review response vs prompt schema | Pending P3-01 (versioned review schema). `architecture.md` is not in the P0-04 Files list, so the lead must confirm. |
| `docs/troubleshooting.md` duplicate | Resolved: section 4. |
| `docs/limitations.md:2` stray fence | Resolved: section 5. |
| `docs/changelog.md` 2 lines | Resolved: section 6. |
| `AGENTS.md` "never commit `__pycache__`" vs tracked `.pyc` | Resolved in working tree (D-010: staged `.pyc` deletions, `.gitignore` updated). Needs the user's commit; no docs change. |
| Settings UI defaults OpenAI (`settings/page.tsx:18-19`) | Pending P1-01 (AC item 6). Not in P0-04 Files. |

Extra fixes found while verifying (each needs approval; not in the original list):
- 1h: README `:151` changelog bullet claims the Learn More and Deploy sections are preserved. Stale once 1b and 1d land.
- 1i: README `:37` says records go to `audit_logs`. The SQLite table is `audit_requests`; `audit_logs/` is the text-file store.
- 3b: dropped at lead review — changing the example to `~/models` would hide models the Python script writes to `<repo>/downloads/models` (`scripts/validate_and_download_model.py:17`); aligned later by P5-08.

---

## 1. `README.md`

### 1a. Remove create-next-app boilerplate (`:1-2`, `:9-25`)

Replace lines 1-2 (`This is a [Next.js]... create-next-app...` and the blank line) with nothing. The file then starts with `# SQLLens` (line 3).

Replace `:9-25` (from "First, run the development server:" through the Geist paragraph) with:

````diff
-First, run the development server:
+Start the development server from the repository root:
 
 ```bash
 npm run dev
-# or
-yarn dev
-# or
-pnpm dev
-# or
-bun dev
 ```
 
 Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
-
-You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.
-
-This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.
````

Evidence: `package.json:7` (`"dev": "next dev"`); the alternative runners are not documented in `package.json` or `AGENTS.md`. Geist/`next/font`: no matches for `Geist|next/font` in `src/`. The page is at `src/app/page.tsx` (not `app/page.tsx`).

### 1b. Remove "Deploy on Vercel" (`:140-144`) (D-008: local/self-hosted only)

Delete lines 140-144 (heading `## Deploy on Vercel` through the nextjs.org deployment link and its trailing blank line).

Evidence: D-008 APPROVED (`.team/decisions.md`, "A local"). Hosted deployment is not supported.

### 1c. Remove "Learn More" boilerplate (`:131-138`)

Delete lines 131-138 (`## Learn More` through "...contributions are welcome!" and its trailing blank line).

Evidence: links to the Next.js generic docs and GitHub repo only; no SQLLens content.

### 1d. Fix LLM layer claim (`:34`)

Replace:

````diff
-- LLM Layer: Uses Hugging Face `transformers` models to review, explain, and optimize stored procedures based on captured telemetry, query patterns, and IO anomalies.
+- LLM Layer: Runs ONNX text-generation models in-process on the Next.js server with Transformers.js (`@huggingface/transformers` 4.2.0) to review stored procedures based on captured telemetry, query patterns, and IO anomalies. The Python `transformers` library is not used by the app; the Python script `scripts/validate_and_download_model.py` only downloads and validates model files.
````

Evidence: `src/app/api/review/route.ts:2` (`import { pipeline } from "@huggingface/transformers"`), `:94` (`pipeline("text-generation", ...)`); `package.json:20` (`"^4.2.0"`); `scripts/validate_and_download_model.py` (Python). Planned: P3-02 may change the inference service; this text describes the current state only.


### 1e. Add `.onnx` to weight list (`:287-291`)

````diff
 - At least one supported weight file:
   - `.safetensors`
   - `.bin`
   - `.pt`
   - `.pth`
+  - `.onnx`
````

Evidence: `scripts/validate_and_download_model.py:19-25` (`WEIGHT_EXTENSIONS` includes `.onnx`). The Transformers.js route still needs ONNX weights (README `:298-302`, unchanged).

### 1f. Replace machine-local path (`:240-245`)

````diff
 ```bash
-cd /Users/kamalsoft/dev/dbPro/sqlens
-
-python3 scripts/validate_and_download_model.py \
+# run from the repository root (the directory that contains package.json)
+python3 scripts/validate_and_download_model.py \
   onnx-community/Qwen2.5-0.5B-Instruct-ONNX
 ```
````

Evidence: the repo path in `:241` is specific to one workstation; the remote is `kamalsoft/sqlens` per discovery §8. The script resolves its root from `__file__` (`scripts/validate_and_download_model.py:17`), so the repo-root instruction is enough.

### 1g. Fix storage label (`:58`)

````diff
-    STORE[(SQLite / Audit Logs / Metadata)]
+    STORE[(SQLite via better-sqlite3 / Audit Logs)]
````

Evidence: `src/db/index.ts:7` at HEAD (raw better-sqlite3; no Prisma client in the code path). Tables are created by `src/db/migrations/001_baseline.sql` (`audit_requests` at `:24`). No change to `prisma.config.ts` is proposed here.

### 1h. Extra (needs approval): remove stale changelog bullet (`:151`)

Delete the line:

````diff
-- Preserved the original Getting Started, Learn More, and Deploy sections while adding SQLLens-specific topology and security details.
````

Reason: sections 1b and 1c remove the sections it describes.

### 1i. Extra (needs approval): clarify audit storage (`:37`)

````diff
-- Audit Log Store: Persists execution records to `audit_logs` and supports later comparison and review.
+- Audit Log Store: Persists execution records to the `audit_requests` SQLite table and writes a text copy of each run to `audit_logs/`, supporting later comparison and review.
````

Evidence: `src/db/migrations/001_baseline.sql:24`; `src/lib/sp-executor.ts:11` and `:69` (text files under `audit_logs/`).

---

## 2. `docs/api.md` (replace whole file)

Evidence for all rows: `src/app/api/<path>/route.ts` (13 route files, verified with `find src/app/api -name route.ts`). Auth column is the current state: "none" = no cookie check; "cookie" = reads `session_token` and falls back to `anonymous` where noted. There is no `middleware` file, so no route is protected.

````markdown
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
````

---

## 3. `docs/configuration.md`

### 3a. Replace line 13 (corrupted) and line 14

Replace line 13 (the corrupted paragraph) with:

````markdown
Hugging Face token (current behavior): the app reads the token from the `apiKey` field in `data/appconfig.json` and passes it to the download request (`src/app/api/models/download/route.ts:236`). `GET /api/appconfig` also returns that field (`src/app/api/appconfig/route.ts:7`). The Python script `scripts/validate_and_download_model.py` reads the `HF_TOKEN` environment variable (`:475`); the app does not.

Planned: P1-03 moves the app to `HF_TOKEN` (D-007), and P1-02 removes the `apiKey` field. Never commit a token or print its value (see `AGENTS.md`, "Secrets and Generated Files").
````

Replace line 14 ("- Do not execute submitted SQL.") with:

````markdown
- `POST /api/execute` runs the submitted SQL on the engine named in the request (`mssql`, `postgres`, or `simulation`) (`src/app/api/execute/route.ts:53`; `src/lib/sp-executor.ts:23`). It has no live-execution opt-in and falls back to an anonymous session when no cookie is sent (`src/app/api/execute/route.ts:11-12`, `:45-48`). Planned: P2-05 (D-004/D-005) adds the `allowLiveExecution` gate, auth, and typed execution. Until then, do not point it at a database you cannot afford to change.
````

Lines 15-18 stay unchanged (valid).


---

## 4. `docs/troubleshooting.md` (replace whole file)

Condensed from `docs/developer_guide.md` §11 (lines 530-567). Full text stays in the developer guide.

````markdown
# Troubleshooting

Condensed from [Developer Guide §11](developer_guide.md#11-troubleshooting). Limits of the reviewer are in [Limitations](limitations.md).

## Model is not listed

Check:

- `data/appconfig.json` and the expanded `downloadDirectory`.
- The model directory contains `config.json` and a compatible ONNX file under `onnx/`.
- `sqlens-model.json` contains the expected model ID.
- Failed temporary download directories are not counted as models.

Evidence: `src/app/api/review/models/route.ts:6-9`; `src/lib/installed-models.ts`.

## Hugging Face returns HTTP 401

The token is missing, expired, invalid, or lacks access to the repository.

- For the Python script, check that `HF_TOKEN` is set without printing it: `echo "${HF_TOKEN:+HF_TOKEN is set}"`.
- For the app, the token is the `apiKey` field in `data/appconfig.json` (`src/app/api/models/download/route.ts:236`). Check that the field is non-empty without printing its value. Planned: P1-03 switches the app to `HF_TOKEN`.

## Hugging Face returns HTTP 404

The repository ID or its casing is wrong, or the repository no longer exists.

## Safetensors or GGUF files were downloaded

The repository is not usable by the ONNX-based Transformers.js route. Remove the incomplete directory and choose a repository with ONNX weights (`onnx/*.onnx`). The Python script accepts `.onnx` among its weight extensions (`scripts/validate_and_download_model.py:19-25`).

## Review returns HTTP 502 "Unable to parse model response"

The model output was not valid JSON. The model may be too small, the output may be truncated, or the prompt may be too large. Inspect the `details` object in the response (`src/app/api/review/route.ts:276-289`), then reduce the input or use a larger instruction-tuned ONNX model. Planned: P3-01 changes the expected schema.

## Review returns HTTP 422

The model is installed but marked incompatible (`src/app/api/review/route.ts:213-220`). Choose an ONNX model.

## React reports "Objects are not valid as a React child"

`/api/review` returns a structured `result` object. Render its fields individually instead of rendering `{result}` directly.
````

---

## 5. `docs/limitations.md` (remove stray fence)

Delete line 1 (blank) and line 2 (```` ````markdown ````). There is no closing fence in the file (checked: the only fence is line 2). Result starts with `# Limitations`. Content is otherwise unchanged.

Evidence: `rg -n '````|```' docs/limitations.md` returns only `2:````markdown`.

---

## 6. `docs/changelog.md` (add to Unreleased)

````diff
 ## Unreleased
 
+- Added the test stack: Vitest and Testing Library for unit and component tests, Playwright for end-to-end tests, and the `test`, `test:e2e`, and `typecheck` scripts (`package.json:12-14`; `vitest.config.mts`; `playwright.config.ts`). Decision D-009.
+- Excluded `.agents/**` (vendored agent skills) from ESLint (`eslint.config.mjs`).
+- Ignored Python bytecode, `audit_logs/`, and Playwright output in `.gitignore`; removed tracked `.pyc` files from the index. Decision D-010.
+- Added the squad team workflow files (`.team/`, `docs/team/`).
 - Added model validation and download documentation.
 - Documented API, configuration, security, testing, deployment, and limitations.
````

Evidence: `.gitignore` (working-tree diff adds `__pycache__/`, `*.pyc`, `audit_logs/`, `/test-results/`, `/playwright-report/`, `/blob-report/`). The `.pyc` removal is staged (`git status`: `D ` on two `scripts/__pycache__/*.pyc`). P0-03 is excluded.

---

## Lead / user checks before apply
- Confirm README `:58` label (1g) and the two extra fixes (1h, 1i).
- The `architecture.md`, `settings/page.tsx` defaults, and `prisma.config.ts` rows remain open (see table above).
- Verify links after apply (manual; `docs/developer_guide.md#11-troubleshooting` anchor).
