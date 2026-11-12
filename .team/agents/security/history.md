# security — history

Append-only learnings (date, task ID, fact, evidence path:line). Scribe promotes durable facts into skills.

- 2026-10-24: role created (D-011). Baseline `22d84fa`.

## 2026-10-24 W1 review (P6-01/02/03/04, P1-02/03/06): CHANGES REQUIRED
- Blocking: login rate-limit key from client-controlled X-Forwarded-For (request-guard.ts:32-35); bucket map clear() reset (request-guard.ts:13).
- Non-blocking: sanitizeNext tab/newline bypass (api-client.ts:17-21); timing on '!disabled' hashes (login/route.ts:32); no Host allowlist vs DNS rebinding (proxy.ts:21); redact regex gaps pwd/api_key/credential (redact.ts:1); downloadDirectory unconstrained + rm -rf of destination (app-config.ts:59, download/route.ts:156); download 500 leaks error.message (download/route.ts:178).
- Known gaps (P6-03b/c): execute, review, review/models, models/download, models/refresh unauthenticated.
- Verified OK: scrypt C2 params, timingSafeEqual, dummy hash, 256-bit tokens, expiry per lookup, server-side logout, cookie flags, admin script no echo/min 12/same DB dir, no apiKey in appconfig GET/file, HF_TOKEN env-only, parameterized SQL, migration 002 non-destructive via tracked runner.

## 2026-10-25 Review part 2 at 7014a4d (W1 recheck, SQL execution, share links)
- W1 fixes: PASS. XFF only with SQLLENS_TRUST_PROXY=1 (request-guard.ts:37-44); LRU eviction, no clear (request-guard.ts:19-24); sanitizeNext rejects control chars/backslash + origin check (api-client.ts:19-31); legacy hashes verified against dummy (login/route.ts:33-34); Host allowlist on /api (proxy.ts:13-32); redact covers pwd/api_key/credential/connection (redact.ts:1); downloadDirectory under $HOME, not $HOME itself (app-config.ts:54-59). Residual Low: no realpath (symlink) check; dotdirs like ~/.ssh allowed.
- SQL execution: CHANGES REQUIRED (Medium). MSSQL COMMIT guard masks string literals, so EXEC('COMMIT') / sp_executesql N'COMMIT' (or EXEC of a proc that commits) passes (sql-scan.ts:86, mssql.ts:77,124) and breaks D-005 "batch never commits". Postgres OK (COMMIT inside DO/CALL in a tx block errors). Low: textFilePath returned to client (sp-executor.ts:268); scrubConnection skips values < 3 chars (sp-executor.ts:70); D-028 flag covers audit_logs only, SQLite audit still stores batch SQL (execute/route.ts:17).
- Verified OK: requireSession + per-session rate limit on execute/connections/test; credentials never in audit (C10); TLS defaults encrypt+verify, TLS_WARNING surfaced; rollback in finally both engines; timeouts + cancel (mssql cancel, pg_cancel_backend); generic 502 on conn test; IDENT_RE for proc names, typed params.
- Share links: PASS. 256-bit base64url token (audit-repo.ts:222); expiry required, NULL = expired (audit-repo.ts:255-258); revocation; ownership check by session; login required on /api/share (D-025 B); no minting in execute; compare returns sharedToken:null. Low: shareTtlHours config max 8760 vs route cap 720 (app-config.ts:91 vs share/route.ts:33); tokens stored in plaintext.

## 2026-11-12 listProcedures + POST /api/execute/procedures (features/execute-redesign, uncommitted)
- SIGN-OFF WITH CONDITIONS. Fixed query text, no user input; gates identical to /databases except database required; catalogNames keeps timeout race + pool.close in finally; generic 502, logError name/code only.
- Conditions: catalogNames must only receive literal queries (private, comment says fixed); timeout/cleanup tested for listProcedures only if covered.

## 2026-11-12 AD-1..AD-3 (features/audit-record-page, uncommitted) - SIGN-OFF WITH CONDITIONS
- request.prompt stored for review/compare/refactor; lookupShare returns response_payload only, so share links do not expose prompt/request.
- logSqlText only gates executor logging (sp-executor.ts:89); audit rows already store request.sql, so prompt adds no new class of data.
- sourceAuditId checked with getAudit(id, sessionId) + type check (refactor/route.ts:47-58); relatedAudits filters session_id in both queries with bound params (audit-repo.ts:168-178). No IDOR/SQLi found.
- Condition: prompt duplicates SQL (maxSqlLength up to 5,000,000) so rows roughly double; accepted as size note, consider cap later.
- Page renders JSON in <pre> text, no dangerouslySetInnerHTML.

## 2026-11-12 — Inference worker process (uncommitted, features/audit-record-page)
- Verdict: SIGNED OFF WITH CONDITIONS.
- fork: fixed path, no shell, execArgv [], env allowlist PATH/HOME/NODE_ENV (src/lib/inference.ts:208-216). OK.
- Test hook SQLLENS_TRANSFORMERS_MODULE gated on NODE_ENV==="test" (inference.ts:209); requires server env control already. OK.
- IPC carries SQL/prompt; worker logs nothing; stdout ignored, stderr inherited. OK.
- Crash 502 message = signal/exit code only (inference.ts:65,231; model-run.ts:90-91). OK.
- Conditions: worker generic error message (inference-worker.mjs:66) relayed to API/status may carry local paths; a stuck native call delays disconnect-exit (inference-worker.mjs:74).

## 2026-11-12 - features/review-redesign (RV-1..RV-4) uncommitted diff
- Verdict: SIGNED OFF WITH CONDITIONS.
- Scoping OK: listAudits/getAudit filter by session_id (src/db/audit-repo.ts:141,205); review executionAuditId uses getAudit(id, sessionId).
- RunPicker preview derives from normalizeTelemetry allow-list (timings, io rows capped, plan capped); no rawOutput. Subset of own /api/audit/<id>.
- reviewModel <=1024 string, reviewSchema enum; resolveModel still validates chosen id.
- Review no longer returns model SQL; rewrite-check remains in src/lib/refactor.ts:96,159 for /api/refactor.
- Conditions: test that no-modelId path + config.reviewModel not installed falls back; test that review response has empty rewrittenProcedure even when model emits a rewrite block.
