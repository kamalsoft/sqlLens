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

## 2026-11-12 — Phase SEC (SEC-T1..T9) sign-off, branch features/security-compliance (uncommitted)
- Verdict: SIGNED OFF WITH CONDITIONS.
- prompt-path.ts:19-21 realpath + root+sep prefix blocks traversal/symlink escape; TOCTOU needs local write to data/prompts (out of threat model). Accepted.
- CSP 'unsafe-inline' script-src (next.config.ts:11): weak against XSS but acceptable for no-nonce static build; object-src none, frame-ancestors none, base-uri self hold. Only innerHTML is emotion-registry.tsx:53,59 (CSS).
- purgeExpired (audit-repo.ts:152-166): feedback->audits->unreferenced expired sessions; users untouched; share links live on the row. Correct.
- deleteAudit (audit-repo.ts:138-146) scoped by session_id in a tx; route needs session, rate limit, proxy Origin check. Owner-only OK.
- Token migration (session-tokens.ts:10) idempotent: legacy tokens are 43 chars, hashes are 64. OK.
- Login limiter (request-guard.ts:53): per-username + global remain; global 20/min is a lockout-DoS lever for a local client. Accepted.
- Conditions: C1 scrubText (redact.ts:10-15) misses URL creds (postgres://u:p@h), secret=/api_key=/token=, JSON "password":"x", double-quoted and space-containing values -> add patterns + tests. C2 sp-executor.ts:50 mkdir mode only applies on create, so chmod 0700 the existing dir (and 0600 existing logs).

## 2026-11-12 Phase ED (features/sql-editor, uncommitted): CodeMirror 6 SqlEditor - SIGNED OFF
- Supply chain: `npm audit --omit=dev` 0 vulns. Tree dedupes to a single @codemirror/view 6.43.15 and @lezer/common 1.5.5. Seven direct pins are exact. The 15 new lock entries all resolve from registry.npmjs.org. No new hasInstallScript: the 5 existing ones are better-sqlite3, fsevents, onnxruntime-node, protobufjs and unrs-resolver. The packages declare only `prepare`, and npm does not run that for registry installs.
- CSP (next.config.ts:9-13): `style-src 'unsafe-inline'` covers style-mod <style> elements and inline style attributes. There is no eval or new Function in the dist files, and `connect-src 'self'` is unchanged. No CSP change needed.
- DOM: SqlEditor.tsx has no innerHTML, dangerouslySetInnerHTML, eval or fetch calls. SQL goes into the editor only as CM doc text (lines 65 and 88) and comes out as a string via doc.toString() (line 76).
- Search: @codemirror/search dist has no fetch, XHR, WebSocket or sendBeacon calls, and no innerHTML.

## 2026-11-12 — Phase HL (lang-json/lang-xml + code-highlight) — BLOCKED
- Supply chain OK: `npm audit --omit=dev` 0 vulns; all 829 lock `resolved` URLs are registry.npmjs.org; no new install scripts (lang-json 6.0.2, lang-xml 6.1.0, @lezer/json 1.0.3, @lezer/xml 1.0.6).
- Injection OK: src/components/HighlightedCode.tsx renders React text nodes only; className comes from fixed `codeHighlighter` map (src/lib/code-highlight.ts:11). No innerHTML in new code. No CSP change needed.
- DoS FAIL (measured in node, src/lib/code-highlight.ts:44):
  1. Deep nesting under the 200 KB cap (`[`x30000, `<a>`x30000, unclosed `<a b="` repeats) throws RangeError (stack overflow in @lezer/common copyToBuffer). Uncaught inside useMemo; no error.tsx/ErrorBoundary in src -> page crash.
  2. Malformed JSON `{` + `"\` repeated is quadratic: 20 KB 0.55 s, 40 KB 2.1 s, 199 KB 52.5 s main-thread hang.
- Required: try/catch around parse -> plain fallback; gate JSON on JSON.parse success (linear) or lower cap to ~20 KB (cap applies to xml too); add regression tests for both inputs.

## 2026-11-12 — Phase HL re-review (fixes in src/lib/code-highlight.ts) — still BLOCKED
- Fixed/verified: JSON.parse gate (malformed JSON 0 ms; 99k-deep valid JSON overflow caught, plain, 284 ms); try/catch catches RangeError; 50 KB XML/SQL cap; 10 SQL probes at 50 KB all <70 ms.
- NEW FAIL, XML memory (not caught by try/catch): unclosed tag starts grow heap quadratically in lezer xml error recovery. `"<".repeat(n)` as xml: 2k=58 MB, 4k=171 MB, 8k=590 MB; 50k -> V8 "heap out of memory" (vitest process killed). Reachable via auto: `"<a" + "<".repeat(n) + "/>"` passes detectLanguage. Variants `<a`, `<a=`, `<a b` also costly (70-250 MB at 8 KB), so a regex gate is fragile.
- Required: gate XML like JSON, on a well-formedness check before lezer (e.g. DOMParser 'application/xml' with no <parsererror>, client only; plain on SSR/hydration, so no mismatch), or a cap of no more than ~2 KB; add a regression test for "<"x50000 as xml and as auto.

## 2026-11-12 — Phase HL third review (XML scanner, lang-xml removed) — SIGNED OFF
- @codemirror/lang-xml and @lezer/xml absent from package.json and lockfile; `npm audit --omit=dev` 0 vulns.
- xmlSegments (src/lib/code-highlight.ts:42): every branch advances i; unclosed comment, CDATA and quote jump to the end; no recursion; the detectLanguage regex has no overlapping quantifiers.
- 16 probes at 200 KB (xml and auto): <, <a, <a=, <a b, <a b=", <!--, <![CDATA[, <>, < , </, mixed: all <=25 ms, heap growth <=16 MB, output lossless. Prior JSON and SQL fixes still hold.
- Follow-up, not blocking: the worst case is about 200k segments, so about 200k React spans (the same tab only). Optional: show plain text above about 50k segments.
