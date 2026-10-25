# SQLLens Implementation Plan (GATE 3 — awaiting approval)

Baseline `22d84fa` · Evidence: `docs/team/discovery.md` (F-IDs) · Decisions: `.team/decisions.md` · Roles: `.team/team.md`
Status: **PROPOSED**. Nothing starts until the user replies `APPROVED: start <task ID>`.

Conventions
- Risk: L / M / H. "Blocked" = waits on a PROPOSED decision.
- Every task's AC implicitly includes: touched files pass `npm run lint` with 0 errors, `npx tsc --noEmit` passes, no secret in diff, author ≠ reviewer.
- "Tests" use the D-009 stack, installed in P0-01. Tests never use network, a real DB, or model weights.
- Live DB or model runs are **manual checks that need user authorization per run**; until done, the result is `[UNVERIFIED]`.

## Execution order (dependency waves)

| Wave | Tasks |
|---|---|
| W0 foundations | P0-01, P0-02, P0-03, P0-04 |
| W1 auth + config core | P6-01, P6-02, P6-03, P6-03b, P6-03c, P6-04, P1-03, P1-02, P1-06 |
| W2 | P1-01, P1-07, P2-01, P2-06, P3-01, P3-05 |
| W3 | P2-02, P2-03, P2-04, P2-05, P3-02, P3-03, P3-04, P6-06, P6-07 |
| W4 | P2-07, P2-08, P3-06, P3-07, P1-04, P1-05, P4-01, P4-04, P4-08, P5-01, P6-08 |
| W5 | P4-02, P4-03, P4-05, P4-06, P5-02, P5-03, P5-04, P5-05, P5-06, P5-08 |
| W6 | P4-07, P5-07, P7-02, P7-03, P7-04, P7-05 |
| W7 | P7-06, P7-07, P7-08, P7-09, P7-10 |

Auth (Phase 6 core) runs before live execution, because D-004 allows real execution only for an authenticated user who has opted in.

Blocked tasks: none — all decisions D-016–D-032 APPROVED 2026-10-24. Live DB/model runs still need per-run authorization.

---

## Phase 0 — Foundations

#### P0-01 Install the test stack and scripts
- Owner/Reviewer: lead / qa · Deps: — · Blocked: — (D-009 approved; **the install itself needs the user's go-ahead**) · Risk: M (new deps, network to the npm registry)
- Files: `package.json`, `package-lock.json`, `vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts`
- AC: (1) devDeps include vitest, @testing-library/react, @testing-library/jest-dom, jsdom, @playwright/test at exact pinned versions. (2) Scripts `test`, `test:e2e`, `typecheck` exist. (3) `npm test` exits 0 with one sample test. (4) `.storybook/` is not referenced anywhere (D-009).
- Tests: sample unit test · Docs: `docs/developer_guide.md` §7, §10, `docs/contributing.md`

#### P0-02 Exclude `.agents/**` from lint
- Owner/Reviewer: lead / qa · Deps: — · Blocked: D-019 · Risk: L
- Files: `eslint.config.mjs`
- AC: `npm run lint` output contains no `.agents/` paths.
- Tests: lint run · Docs: none

#### P0-03 SQL migration framework + configurable DB path
- Owner/Reviewer: backend / lead · Deps: P0-01 · Blocked: D-020, D-022 · Risk: H (touches the real DB file)
- Files: `src/db/index.ts`, `src/db/migrations/001_baseline.sql`, `src/db/migrate.ts`
- AC: (1) `001_baseline.sql` reproduces `src/db/index.ts:17-50` exactly. (2) A `schema_migrations` table records applied IDs; re-running applies nothing. (3) The DB directory comes from the D-022 setting and defaults to the current `../../sqllens_db`. (4) An existing DB opens with no data loss: back it up before the first run, with user approval.
- Tests: migrate a temp DB twice and check idempotency; run the baseline on a DB that already has the tables · Docs: `docs/configuration.md`, `docs/architecture.md`

#### P0-04 Fix existing doc defects
- Owner/Reviewer: scribe / lead · Deps: — · Blocked: D-016 · Risk: L
- Files: `README.md`, `docs/api.md`, `docs/configuration.md`, `docs/troubleshooting.md`, `docs/limitations.md`, `docs/changelog.md`
- AC: every row of discovery §8 is resolved or marked "pending task X"; the README has no create-next-app boilerplate (`:1,13-25,131-144`) and no Vercel section (D-008); the user approves the diff before it is applied.
- Tests: link check (manual) · Docs: itself

## Phase 1 — Complete core workflows

#### P1-03 Download token from `HF_TOKEN` env (D-007)
- Owner/Reviewer: ai-models / security · Deps: — · Risk: M
- Files: `src/app/api/models/download/route.ts`
- AC: the token is read only from `process.env.HF_TOKEN`; nothing references `config.apiKey`; the token never appears in a response or a log.
- Tests: route unit test with a mocked `downloadRepository` that asserts the token argument · Docs: `docs/configuration.md`, `docs/model-management.md`

#### P1-02 Secure, validated appconfig API + execution preferences
- Owner/Reviewer: backend / security · Deps: P1-03 · Risk: M
- Files: `src/lib/app-config.ts`, `src/app/api/appconfig/route.ts`, `data/appconfig.json`
- AC: (1) The `apiKey` field is removed from the type, the defaults and the JSON. (2) GET contains no secret field. (3) PUT validates types and returns 400 naming the bad field. (4) PUT merges onto the **current** config; today omitted fields are reset to defaults (`appconfig/route.ts:16-19`). (5) New fields: `allowLiveExecution` (default false, D-004), `queryTimeoutMs`, `defaultEngine`, `maxSqlLength` (D-023), `inferenceTimeoutMs` (D-030).
- Tests: API tests for GET without secrets, PUT partial update, and PUT invalid → 400 · Docs: `docs/configuration.md`, `docs/api.md`

#### P1-06 Shared stored-procedure input validator
- Owner/Reviewer: backend / security · Deps: P1-02 · Blocked: D-023 · Risk: L
- Files: `src/lib/validation/sql-input.ts`
- AC: rejects empty or whitespace-only input, input longer than `maxSqlLength`, and NUL bytes; returns `{ ok, error }`; never executes or rewrites the SQL.
- Tests: unit table tests · Docs: `docs/api.md`

#### P1-01 Settings form fully controlled
- Owner/Reviewer: frontend / backend · Deps: P1-02, P6-04 · Risk: L
- Files: `src/app/settings/page.tsx`, `src/components/AppShell.tsx`
- AC: (1) Every config field uses `value` + `onChange`; there are no `defaultValue` inputs (today at `:148-171`). (2) No API-key input (D-007). (3) The page does not wrap `AppShell` a second time (`:87`), so exactly one sidebar `nav` renders. (4) The Settings nav link is restored (`AppShell.tsx:11`). (5) After save and reload, the values persist. (6) Client defaults are no longer OpenAI (`:18-19`).
- Tests: component tests for controlled fields and for save sending PUT with every field · Docs: `docs/developer_guide.md`

#### P1-07 Loading / success / error states on primary workflows
- Owner/Reviewer: frontend / qa · Deps: P0-01 · Risk: L
- Files: `src/app/{review,execute,compare,manage-models,share/[token]}/page.tsx`, `src/app/page.tsx`
- AC: each page shows a loading indicator while a request is pending, a success state, and an error message taken from the API `error`; buttons are disabled while pending; the set-state-in-effect lint errors are fixed (`manage-models/page.tsx:89`, `providers.tsx`).
- Tests: component tests per page with mocked fetch (pending, ok, error) · Docs: none

#### P1-04 Real analysis stats API
- Owner/Reviewer: backend / lead · Deps: P2-06 · Risk: L
- Files: `src/app/api/analysis/route.ts`
- AC: GET computes totals, averages and the 10 most recent records from the session's `audit_requests`, excluding simulated rows (D-004); the broken POST is removed (`:42-58`); requires a session.
- Tests: API test with a seeded temp DB · Docs: `docs/api.md`

#### P1-05 Dashboard renders real stats
- Owner/Reviewer: frontend / backend · Deps: P1-04 · Risk: L
- Files: `src/app/page.tsx`
- AC: shows totals plus an empty state when there are none; no hardcoded or mock numbers.
- Tests: component test · Docs: none

## Phase 2 — SQL execution and analysis

#### P2-01 Extract and fix telemetry parsers
- Owner/Reviewer: sql-engine / qa · Deps: P0-01 · Risk: M (type change ripples to the UI)
- Files: `src/lib/telemetry/{mssql,postgres,types}.ts`, `src/lib/sp-executor.ts`, `src/lib/audit-analyzer.ts`
- AC: (1) Parsers are pure and exported. (2) LOB reads are parsed. (3) Multiple statements are aggregated per table. (4) PostgreSQL CPU is `null` rather than `execMs*0.8` (`sp-executor.ts:326`). (5) Unknown values are `null` and handled null-safely in `audit-analyzer.ts`.
- Tests: fixture-based unit tests (see `sqllens-telemetry-parsing/references/formats.md`) · Docs: `docs/architecture.md`

#### P2-06 Persist executions with metadata
- Owner/Reviewer: backend / sql-engine · Deps: P0-03 · Risk: M
- Files: `src/db/migrations/002_execution_metadata.sql`, `src/db/audit-repo.ts`
- AC: (1) `audit_requests` gains `engine`, `simulated`, `status`, `record_number`, `elapsed_ms`, `logical_reads`, `schema_version`, and `shared_token` becomes nullable. (2) The record number comes from the DB sequence, not `readdir` (`sp-executor.ts:74-79`). (3) A repo function is the only writer.
- Tests: repo unit tests on a temp DB · Docs: `docs/architecture.md`

#### P2-05 Execution request contract, policy and validation
- Owner/Reviewer: sql-engine / security · Deps: P1-02, P1-06, P2-06, P6-03b · Risk: H
- Files: `src/app/api/execute/route.ts`, `src/lib/execution/request.ts`
- AC: (1) The body is `{ mode: "procedure", name, params:[{name,type,value}] }` or `{ mode: "batch", sql }`, plus `compare`. (2) Procedure and parameter names must match a strict identifier pattern. (3) A real engine requires a session and `allowLiveExecution=true`, otherwise 403. (4) Simulation results carry `simulated:true` and are stored with that flag. (5) The password is never persisted or logged.
- Tests: route tests per rule with a mocked executor · Docs: `docs/api.md`, `docs/configuration.md`

#### P2-02 SQL Server execution (D-005)
- Owner/Reviewer: sql-engine / security · Deps: P2-01, P2-05 · Risk: H
- Files: `src/lib/execution/mssql.ts`, `src/lib/sp-executor.ts`
- AC: (1) Static import (fixes `:224`). (2) STATISTICS IO/TIME are captured from request `info` events. (3) The actual plan is captured via `SET STATISTICS XML ON` and stored. (4) Procedure mode uses `request.input()` typed parameters with `EXEC`. (5) Batch mode runs inside `BEGIN TRAN … ROLLBACK` in `finally`. (6) `requestTimeout` comes from config. (7) Pools are closed in `finally`.
- Tests: unit tests with a mocked `mssql` request emitting info and recordset events; rollback is always called · Manual: one live run against a user-provided DB **[needs authorization]** · Docs: `docs/developer_guide.md`

#### P2-03 PostgreSQL execution (D-005)
- Owner/Reviewer: sql-engine / security · Deps: P2-01, P2-05 · Blocked: D-024 · Risk: H
- Files: `src/lib/execution/postgres.ts`
- AC: (1) Procedure mode runs `CALL name($1..$n)`, or `SELECT` for functions, with bound parameters. (2) Batch mode runs in `BEGIN … ROLLBACK`. (3) `statement_timeout` is set from config. (4) Telemetry uses the D-024 approach. (5) The client is closed in `finally`.
- Tests: mocked `pg` client · Manual: a live run **[needs authorization]** · Docs: `docs/developer_guide.md`

#### P2-04 Connection test endpoint
- Owner/Reviewer: sql-engine / security · Deps: P2-05 · Risk: M
- Files: `src/app/api/connections/test/route.ts`
- AC: POST returns `{ ok, engine, serverVersion, encrypted }` within a 5 s timeout; requires a session; never echoes credentials; errors are generic.
- Tests: route test with mocked drivers · Docs: `docs/api.md`

#### P2-07 Query timeout and cancellation
- Owner/Reviewer: sql-engine / security · Deps: P2-02, P2-03 · Risk: M
- Files: `src/lib/execution/*.ts`, `src/app/api/execute/route.ts`
- AC: when the client aborts (`request.signal`), mssql calls `request.cancel()` and PostgreSQL cancels the backend; a timeout returns 504; the batch transaction is still rolled back.
- Tests: mocked drivers with an abort signal · Docs: `docs/api.md`

#### P2-08 Execute page UI
- Owner/Reviewer: frontend / sql-engine · Deps: P2-04, P2-05, P2-07 · Risk: M
- Files: `src/app/execute/page.tsx`
- AC: procedure/batch toggle; parameter editor; "Test connection" button; Cancel button; "Simulated" badge; `null` metrics shown as "not captured"; `any` types removed (lint).
- Tests: component tests · Docs: none

## Phase 3 — Local Transformers integration

#### P3-01 Versioned review schema (D-001)
- Owner/Reviewer: ai-models / lead · Deps: P0-01 · Blocked: D-021 · Risk: M
- Files: `src/lib/review-schema.ts`, `data/prompts/analysisSP.v1.md` (new), `data/prompts/analysisSP.md` (becomes v2), `src/app/api/review/route.ts`
- AC: (1) Validator v1 is today's `issues[]` schema (`review/route.ts:306-361`). (2) Validator v2 matches `analysisSP.md:58-100`. (3) The request's `schemaVersion` selects the prompt and validator, defaulting per D-021. (4) The response includes `schemaVersion`.
- Tests: unit tests per version with valid and invalid fixtures · Docs: `docs/prompting.md`, `docs/api.md`

#### P3-05 Enforce the local trust boundary (D-003)
- Owner/Reviewer: ai-models / security · Deps: P1-02 · Risk: L
- Files: `src/lib/ai-transformer.ts`, `src/app/api/models/refresh/route.ts`
- AC: no OpenAI/Ollama/cloud provider remains selectable; the only outbound host anywhere in `src/` is `huggingface.co` (checked by `rg "fetch\("` review); review and compare make no network calls.
- Tests: unit test asserting the review service never calls `fetch` · Docs: `docs/architecture.md`, `README.md` security section

#### P3-02 Inference service with configurable options
- Owner/Reviewer: ai-models / lead · Deps: P3-01 · Risk: M
- Files: `src/lib/inference.ts`, `src/app/api/review/route.ts`
- AC: (1) The pipeline cache moves into the service. (2) `dtype` comes from the ONNX file that is actually present; today `q4` is hardcoded (`:95`) even when only `model_quantized.onnx` exists. (3) `temperature` and the context window come from config. (4) The prompt token count is checked against the window, returning 400 when it is too large.
- Tests: unit tests with a mocked `pipeline` factory · Manual: one inference with the installed Qwen ONNX model **[needs authorization]** · Docs: `docs/configuration.md`

#### P3-03 Model availability and inference status
- Owner/Reviewer: ai-models / lead · Deps: P3-02 · Risk: L
- Files: `src/app/api/models/status/route.ts`
- AC: GET returns, per installed model, `{ compatible, loaded, loading, lastError }`; requires a session.
- Tests: route test · Docs: `docs/api.md`

#### P3-04 Prompt templates per workflow
- Owner/Reviewer: ai-models / lead · Deps: P3-01 · Risk: L
- Files: `data/prompts/{compare.md,explainStatistic.md,review-with-telemetry.md}`
- AC: each template has documented placeholders; `explainStatistic.md` is no longer empty; every template tells the model not to invent schema, indexes or plans (`docs/prompting.md:11`).
- Tests: unit test that each template has its required placeholders · Docs: `docs/prompting.md`

#### P3-06 Inference timeout and fallback
- Owner/Reviewer: ai-models / lead · Deps: P3-02 · Blocked: D-030 · Risk: M
- Files: `src/lib/inference.ts`, `src/app/api/review/route.ts`
- AC: a timeout returns 504 with an actionable message; one inference runs at a time and others queue or get 429; there is no silent mock fallback.
- Tests: unit test with a slow mock · Docs: `docs/troubleshooting.md`

#### P3-07 Review page UI for v1 and v2 results + model status
- Owner/Reviewer: frontend / ai-models · Deps: P3-01, P3-03, P3-06 · Risk: L
- Files: `src/app/review/page.tsx`, `src/components/review/*`
- AC: renders v1 issues and the v2 tables; shows model status and timeout errors; offers optional telemetry from an execution record (DoD 6).
- Tests: component tests · Docs: none

## Phase 4 — Review, compare, recommendations

#### P4-01 Review end to end with persistence and optional telemetry
- Owner/Reviewer: ai-models / backend · Deps: P3-02, P3-04, P1-06, P2-06, P6-03c · Risk: M
- Files: `src/app/api/review/route.ts`
- AC: requires a session; input passes the validator; optional `executionAuditId` injects normalized telemetry into the prompt; the result is persisted as `REVIEW` with `schema_version` and the model ID; the response includes the audit `id`.
- Tests: route test with a mocked inference service and a temp DB · Docs: `docs/api.md`

#### P4-04 Null-safe before/after metrics
- Owner/Reviewer: sql-engine / qa · Deps: P2-01 · Risk: L
- Files: `src/lib/audit-analyzer.ts`
- AC: `compareExecutions` returns deltas and percentages for reads, scans, CPU and elapsed; a `null` input gives a `null` delta; simulated vs real comparisons are rejected (D-004).
- Tests: unit tests · Docs: none

#### P4-08 Audit reopen API
- Owner/Reviewer: backend / security · Deps: P2-06, P6-03 · Risk: M
- Files: `src/app/api/audit/route.ts`, `src/app/api/audit/[id]/route.ts`
- AC: GET by ID returns the full record only to its owner, otherwise 404; the list includes type, simulated flag and summary.
- Tests: route tests covering owner and non-owner · Docs: `docs/api.md`

#### P4-02 Model-based compare with normalized telemetry
- Owner/Reviewer: ai-models / sql-engine · Deps: P3-04, P4-04, P4-08 · Risk: M
- Files: `src/app/api/compare/route.ts` (ownership moves from backend to ai-models; decision note D-031), `src/lib/ai-transformer.ts`
- AC: input is `{ originalAuditId, optimizedAuditId }` or two SP texts; the compare prompt receives both procedures plus the metric deltas; `mockReview` is no longer used; the result is persisted as `COMPARE`.
- Tests: route test with mocked inference · Docs: `docs/api.md`

#### P4-03 Recommendations grouped by severity and category
- Owner/Reviewer: frontend / ai-models · Deps: P3-07 · Risk: L
- Files: `src/components/review/*`
- AC: grouped by severity (critical→low) and then by category (v2) or "uncategorized" (v1).
- Tests: component test · Docs: none

#### P4-05 Accept, reject and notes on recommendations
- Owner/Reviewer: backend / security · Deps: P0-03, P4-01, P4-08 · Risk: M
- Files: `src/db/migrations/003_recommendation_feedback.sql`, `src/app/api/audit/[id]/recommendations/route.ts`
- AC: PATCH sets `accepted|rejected|pending` plus a note (≤2000 chars) per recommendation key; only the owner may do it; the feedback is returned when the record is reopened.
- Tests: route tests · Docs: `docs/api.md`

#### P4-06 Share links with access control and expiry
- Owner/Reviewer: backend / security · Deps: P2-06, P4-08 · Blocked: D-025 · Risk: H
- Files: `src/db/migrations/004_share.sql`, `src/app/api/audit/[id]/share/route.ts`, `src/app/api/share/[token]/route.ts`, `src/app/api/{execute,compare}/route.ts` (owners remove auto-minting)
- AC: no token is minted automatically (today at `compare/route.ts:28`, `execute/route.ts:79`); POST creates a token with a TTL, DELETE revokes it; GET returns 410 after expiry; access follows D-025; tokens are random with ≥128 bits.
- Tests: route tests for expiry, revocation and access · Docs: `docs/api.md`

#### P4-07 Compare, audit history, share and feedback UI
- Owner/Reviewer: frontend / backend · Deps: P4-02..P4-06, P4-08 · Risk: M
- Files: `src/app/compare/page.tsx`, `src/app/audit/page.tsx` (new), `src/app/audit/[id]/page.tsx` (new), `src/app/share/[token]/page.tsx`
- AC: before/after metric table; a history list that reopens a record (DoD 8); accept/reject/notes controls; share dialog with TTL and revoke.
- Tests: component tests · Docs: `docs/developer_guide.md` §Application Areas

## Phase 5 — Model management

#### P5-01 Preflight metadata validation
- Owner/Reviewer: ai-models / security · Deps: P1-03 · Risk: M
- Files: `src/lib/huggingface-download.ts`, `src/app/api/models/download/route.ts`
- AC: before any file is downloaded, the repository listing is fetched; 422 if there is no compatible ONNX + `config.json` + tokenizer; 401/403/404 are mapped to clear errors; `modelId` is validated as `owner/repo`.
- Tests: unit tests with mocked fetch · Docs: `docs/model-management.md`

#### P5-02 Download jobs with progress + duplicate prevention
- Owner/Reviewer: ai-models / security · Deps: P5-01, P6-03c · Risk: M
- Files: `src/lib/model-jobs.ts`, `src/app/api/models/download/route.ts`, `src/app/api/models/download/[jobId]/route.ts`
- AC: POST returns 202 + `jobId`; GET reports `{ state, bytesDone, bytesTotal, filesDone, filesTotal, error }`; the same model already active or installed → 409 (wires `modelAlreadyInstalled`, `:200`); `maxConcurrentDownloads` is respected; jobs are in-memory (single local process, D-008).
- Tests: unit tests with a fake downloader · Docs: `docs/api.md`, `docs/model-management.md`

#### P5-03 Cancel and retry
- Owner/Reviewer: ai-models / qa · Deps: P5-02 · Risk: M
- Files: `src/lib/model-jobs.ts`, `src/lib/huggingface-download.ts`
- AC: DELETE on a job aborts it and removes the temp dir; each file retries 3× with backoff; a retried job skips files already verified.
- Tests: unit tests · Docs: `docs/model-management.md`

#### P5-04 Checksum and integrity validation (TS)
- Owner/Reviewer: ai-models / security · Deps: P5-02 · Risk: M
- Files: `src/lib/validate-model.ts`, `src/lib/huggingface-download.ts`
- AC: SHA-256 is verified against the hub's LFS hashes where the API provides them (`[UNVERIFIED]` field availability; confirm in the task); `checksums.json` is written; a mismatch fails the job and cleans up.
- Tests: unit tests with a fixture file and its hash · Docs: `docs/model-management.md`

#### P5-05 Model deletion and disk usage
- Owner/Reviewer: ai-models / security · Deps: P6-03c · Risk: H (deletes files)
- Files: `src/app/api/models/[id]/route.ts`, `src/app/api/models/refresh/route.ts`
- AC: DELETE removes only a directory resolved inside the download root (path-containment check); 409 while a job or inference is using it; refresh returns total used bytes and free bytes (`fs.statfs`).
- Tests: route tests on a temp dir, including a path-traversal attempt · Docs: `docs/model-management.md`, `docs/api.md`

#### P5-06 Consistent model metadata and catalog
- Owner/Reviewer: ai-models / lead · Deps: P5-02 · Blocked: D-026 · Risk: L
- Files: `src/app/api/models/refresh/route.ts`, `src/lib/installed-models.ts`, `src/lib/app-config.ts` (default model, coordinated with backend)
- AC: one metadata schema (`id, name, sourceUrl, installedAt, lastUsedAt, validated, architecture`); `lastUsedAt` is updated on inference; the catalog lists only ONNX-compatible entries; the default model follows D-026.
- Tests: unit tests · Docs: `docs/model-management.md`

#### P5-08 Align the Python validator with the app
- Owner/Reviewer: ai-models / qa · Deps: P5-06 · Risk: L
- Files: `scripts/validate_and_download_model.py`
- AC: honors `downloadDirectory` from appconfig or `--output` (today hardcoded at `:17`); writes the P5-06 metadata schema; `python3 -m py_compile` passes.
- Tests: py_compile; a dry-run unit test without network · Docs: README "Download and Validate", `docs/model-management.md`

#### P5-07 Manage-models UI
- Owner/Reviewer: frontend / ai-models · Deps: P5-02..P5-06 · Risk: M
- Files: `src/app/manage-models/page.tsx`
- AC: progress bar polling the job; Cancel and Retry; Delete with confirmation; disk usage; per-model error messages.
- Tests: component tests with mocked fetch · Docs: none

## Phase 6 — Authentication and security

#### P6-01 Admin account, password hashing, session expiry (D-006)
- Owner/Reviewer: backend / security · Deps: P0-03 · Blocked: D-027 · Risk: H
- Files: `src/lib/auth.ts`, `src/db/migrations/005_auth.sql`
- AC: `crypto.scrypt` with a random 16-byte salt and `timingSafeEqual`; `sessions.expires_at` is enforced; the admin is bootstrapped per D-027; existing `simulated_hash` and anonymous rows are disabled.
- Tests: unit tests for hash/verify/expiry · Docs: `docs/configuration.md`, `docs/developer_guide.md` §13

#### P6-02 Real login, logout and me
- Owner/Reviewer: backend / security · Deps: P6-01 · Risk: H
- Files: `src/app/api/auth/{login,logout,me}/route.ts`
- AC: wrong password or unknown user → 401 with an identical message; no auto-create (today at `login/route.ts:14-19`); cookie is httpOnly, sameSite=lax, and `secure` in production; logout invalidates the session server-side.
- Tests: route tests · Docs: `docs/api.md`

#### P6-03 Route protection: proxy, helper and backend routes
- Owner/Reviewer: backend / security · Deps: P6-02 · Risk: H
- Files: `src/proxy.ts`, `src/lib/auth.ts`, `src/app/api/{appconfig,audit,analysis,compare}/route.ts`
- AC: the proxy redirects unauthenticated page requests to `/login` (optimistic only, per `proxy.md`); every listed route calls `requireSession()` → 401; the anonymous fallback is removed (`compare/route.ts:19-40`).
- Tests: route tests for 401 and 200 · Docs: `docs/architecture.md`

#### P6-03b Protect the execute route
- Owner/Reviewer: sql-engine / security · Deps: P6-03 · Risk: M · Files: `src/app/api/execute/route.ts`
- AC: `requireSession()` is enforced; the anonymous block (`:39-50`) is removed. · Tests: route test · Docs: `docs/api.md`

#### P6-03c Protect the review and model routes
- Owner/Reviewer: ai-models / security · Deps: P6-03 · Risk: M · Files: `src/app/api/review/**`, `src/app/api/models/**`
- AC: every handler enforces `requireSession()`. · Tests: route tests · Docs: `docs/api.md`

#### P6-04 Login page and session-aware shell
- Owner/Reviewer: frontend / backend · Deps: P6-02 · Risk: M
- Files: `src/app/login/page.tsx`, `src/components/AppShell.tsx`
- AC: a login form with error and loading states; a logout control; the current user is shown via `/api/auth/me`; after logout, protected pages redirect to `/login`.
- Tests: component test; covered by the E2E in P7-05 · Docs: `docs/developer_guide.md`

#### P6-06 Redact credentials and sensitive SQL from logs
- Owner/Reviewer: backend / security (with sql-engine applying it in `sp-executor.ts`) · Deps: P2-06 · Blocked: D-028 · Risk: M
- Files: `src/lib/redact.ts`, `src/app/api/**` (`console.error` sites), `src/lib/sp-executor.ts` (via sql-engine)
- AC: one `logError(ctx, err)` helper strips password/token/HF_TOKEN/connection fields; clients get generic 500 messages; the SQL in `audit_logs/` follows D-028.
- Tests: unit tests for redaction · Docs: `docs/developer_guide.md` §13

#### P6-07 CSRF, rate limiting and request validation
- Owner/Reviewer: backend / security · Deps: P6-03 · Risk: M
- Files: `src/lib/request-guard.ts`, `src/proxy.ts`
- AC: non-GET requests with a foreign `Origin` → 403; in-memory token bucket on login (5/min), execute, review and download → 429; every route body goes through a type guard.
- Tests: unit and route tests · Docs: `docs/api.md`

#### P6-08 TLS enforcement for remote connections
- Owner/Reviewer: sql-engine / security · Deps: P2-02, P2-03 · Risk: M
- Files: `src/lib/execution/{mssql,postgres}.ts`
- AC: mssql defaults to `encrypt:true, trustServerCertificate:false` (today `true` at `sp-executor.ts:235`); PostgreSQL uses `ssl` for non-localhost hosts; any override is explicit per connection and shown as a warning in the result; model downloads stay https-only.
- Tests: unit tests on the built connection options · Docs: `docs/configuration.md`

## Phase 7 — Reliability and quality

#### P7-02 Unit tests: parsers and analysis helpers
- Owner/Reviewer: qa / sql-engine · Deps: P2-01, P3-01, P4-04, P1-06, P6-06 · Risk: L
- Files: `tests/unit/**`
- AC: covers the telemetry parsers, `analyzeExecution` grading, `compareExecutions`, review validators v1/v2, the sql-input validator and redaction; ≥90% line coverage on those modules.
- Docs: `docs/developer_guide.md` §10

#### P7-03 API route tests: auth, execution, review, downloads
- Owner/Reviewer: qa / backend · Deps: P6-03, P2-05, P4-01, P5-02 · Risk: M
- Files: `tests/api/**`
- AC: each route has 401/400/happy-path cases using a temp DB and mocked drivers, inference and downloader.

#### P7-04 Component tests: forms and loading/error states
- Owner/Reviewer: qa / frontend · Deps: P1-01, P1-07, P2-08, P3-07, P5-07, P6-04 · Risk: L
- Files: `tests/components/**`

#### P7-05 E2E test of the primary review workflow
- Owner/Reviewer: qa / ai-models · Deps: P6-04, P3-07, P4-01, P4-07 · Blocked: D-029 · Risk: M
- Files: `tests/e2e/review.spec.ts`
- AC: login → select model → submit SP → result shown → reopen from history passes headless on a clean checkout.

#### P7-06 Lint to zero errors
- Owner/Reviewer: lead (coordinates; each owner fixes their own files) / qa · Deps: P0-02 · Risk: L
- AC: `npm run lint` exits 0.

#### P7-07 CI workflow
- Owner/Reviewer: qa / lead · Deps: P0-01, P7-06 · Blocked: D-018 · Risk: L
- Files: `.github/workflows/ci.yml`
- AC: on PR, runs `npm ci`, lint, `tsc --noEmit`, `npm test` and `npm run build` on a pinned Node version; a red check blocks merge (branch protection is the user's setting).
- Docs: `docs/contributing.md`

#### P7-08 Document supported runtime versions
- Owner/Reviewer: scribe / lead · Deps: P7-07, P2-02, P2-03 manual runs · Risk: L
- Files: `README.md`, `docs/developer_guide.md` §4
- AC: lists Node (the CI version), Next 16.3.3, Transformers.js 4.2.0, and the SQL Server / PostgreSQL versions **actually tested**; anything untested is marked unverified.

#### P7-09 Remove `npm` from runtime dependencies
- Owner/Reviewer: lead / qa · Deps: P7-07 · Blocked: D-017 · Risk: L · Files: `package.json`, `package-lock.json`
- AC: the build and tests pass without it.

#### P7-10 Remove unused Prisma (D-033)
- Owner/Reviewer: lead / qa · Deps: — · Risk: M (package changes, network to the npm registry)
- Files: `package.json`, `package-lock.json`, `prisma.config.ts` (delete)
- AC: (1) `@prisma/client`, `prisma` and the `postinstall` script are removed, and `prisma.config.ts` is deleted. (2) `rg -n "prisma" src` finds nothing. (3) `npm test`, `npm run typecheck` and `npm run build` pass. (4) The npm audit count does not increase.
- Tests: the existing suite · Docs: `docs/developer_guide.md` (any Prisma mentions), `docs/changelog.md`

---

## DoD traceability (9/9)

| DoD criterion | Tasks |
|---|---|
| 1 Sign in, protected workspace | P6-01, P6-02, P6-03, P6-03b, P6-03c, P6-04, P6-07 |
| 2 Configure a local Transformers model | P1-01, P1-02, P3-02, P3-03, P3-05, P5-06 |
| 3 Submit an SP for review | P1-06, P3-01, P3-07, P4-01 |
| 4 Execute safely against SQL Server/PostgreSQL | P2-02, P2-03, P2-04, P2-05, P2-07, P2-08, P6-08 |
| 5 Capture and parse telemetry | P2-01, P2-02, P2-03, P7-02 |
| 6 Optimization review from procedure + telemetry | P3-04, P4-01 (`executionAuditId`), P4-02 |
| 7 Compare original vs optimized | P4-02, P4-04, P4-07 |
| 8 Persist and reopen the audit record | P2-06, P4-01, P4-08, P4-07 |
| 9 Manage models with progress and error handling | P5-01, P5-02, P5-03, P5-04, P5-05, P5-07 |

Roadmap coverage: Phase 1 → P1-01..07 · Phase 2 → P2-01..08 · Phase 3 → P3-01..07 · Phase 4 → P4-01..08 · Phase 5 → P5-01..08 · Phase 6 → P6-01..08 · Phase 7 → P0-01, P7-02..10.

## Documentation plan

| Doc | Updated by tasks |
|---|---|
| `README.md` | P0-04 (remove boilerplate and Vercel, fix `app/page.tsx`, `.onnx` requirement, Python-vs-JS claim, local path → generic), P3-05, P5-08, P7-08 |
| `docs/api.md` | P0-04 (correct the route list), P1-02, P1-04, P1-06, P2-04, P2-05, P2-07, P3-01, P3-03, P4-01, P4-02, P4-05, P4-06, P4-08, P5-02, P5-05, P6-02, P6-03, P6-07 |
| `docs/configuration.md` | P0-03, P0-04 (fix corrupted `:13`), P1-02, P1-03, P2-05, P3-02, P6-01, P6-08 |
| `docs/architecture.md` | P0-03, P2-01, P2-06, P3-05, P6-03 |
| `docs/prompting.md` | P3-01, P3-04 |
| `docs/model-management.md` | P1-03, P5-01..P5-06, P5-08 |
| `docs/developer_guide.md` | P0-01, P1-01, P2-02, P2-03, P4-07, P6-01, P6-04, P6-06, P7-02, P7-08 |
| `docs/troubleshooting.md` | P0-04 (replace the duplicate), P3-06 |
| `docs/limitations.md` | P0-04 (stray fence) |
| `docs/contributing.md` | P0-01, P7-07 |
| `docs/changelog.md` | every merged task (Scribe) |
| `docs/ROADMAP.md` | statuses move only with runtime evidence (Lead), after each wave |
