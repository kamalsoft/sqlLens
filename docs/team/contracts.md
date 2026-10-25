# Shared Contracts (lead, 2026-10-24)

Every task must follow these interfaces, so parallel work fits together. To change a contract, an agent proposes it to lead; it never silently diverges.
Source of truth for task scope: `docs/team/plan.md`. Decisions: `.team/decisions.md`.

## C1. Migrations (supersedes the numbering in plan.md)
Numbers are assigned in this order. Never reuse or renumber them.
`002_auth.sql` (P6-01) · `003_execution_metadata.sql` (P2-06) · `004_recommendation_feedback.sql` (P4-05) · `005_share.sql` (P4-06).
Migrations auto-apply to the real DB at startup (backup: `../../sqllens_db/sqllens.db.bak-20261024`), so they must be additive, idempotent and data-preserving. Use `ALTER TABLE … ADD COLUMN` and new tables. Never drop data.

## C2. Auth — `src/lib/password.ts` (pure, `node:crypto` only, no `@/` imports, no `server-only`)
- `hashPassword(pw: string): string` → `scrypt$16384$8$1$<saltB64>$<hashB64>` (16-byte salt, 64-byte key)
- `verifyPassword(pw: string, stored: string): boolean`, using `timingSafeEqual`. Returns false for any other format (including `simulated_hash` and `n/a`).

## C3. Auth — `src/lib/auth.ts` (server-only)
- Cookie name `session_token`; httpOnly, `sameSite: "lax"`, `secure` when `NODE_ENV === "production"`, path `/`.
- `SESSION_TTL_MS = 7 * 24 * 3600 * 1000`. `sessions.expires_at` is an ISO string, enforced on every lookup.
- `createSession(userId: string): { token: string; expiresAt: string }`. The token is `randomBytes(32).toString("base64url")`.
- `getSessionFromRequest(request: Request): SessionInfo | null` parses the `Cookie` header itself (no `next/headers`, so it's testable). `SessionInfo = { sessionId: string; userId: string; username: string }`.
- `requireSession(request: Request): { ok: true; session: SessionInfo } | { ok: false; response: NextResponse }` (401 `{ error: "Authentication required" }`).
- `invalidateSession(token: string): void`.
- `setSessionCookie(response: NextResponse, token, expiresAt)` / `clearSessionCookie(response)`. Use these on the response object, not `cookies()`.
- Usage in every protected handler:
  ```ts
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  ```
- Every handler signature takes `request: Request`, even GET.
- Public routes: `POST /api/auth/login`, `GET /api/auth/me` (returns `{ authenticated: false }`). Everything else is protected, including share (D-025).

## C4. Admin bootstrap (D-027)
- `npm run admin:set-password` → `node --experimental-strip-types scripts/set-admin-password.ts`.
- The script resolves the DB dir like `src/db/index.ts` (`SQLLENS_DB_DIR`, otherwise `../../sqllens_db`), runs migrations and upserts username `admin`.
- Password input: an interactive prompt without echo when stdin is a TTY, otherwise the first line of stdin (used by E2E). Minimum 12 characters. It never prints the password.

## C5. Proxy — `src/proxy.ts` (Next 16 convention; read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`)
- Page requests with no `session_token` cookie → redirect to `/login?next=<path>`.
- Excluded: `/login`, `/api/**` (handlers return 401 themselves), `/_next/**`, static files, `favicon.ico`.
- This is an optimistic check only. The handler-level `requireSession` is the real enforcement.
- Host allowlist (anti DNS-rebinding): `localhost`, `127.0.0.1` and `[::1]` (any port), plus extra hosts from env `SQLLENS_ALLOWED_HOSTS` (comma-separated). Other hosts → 403 for `/api/**`.
- CSRF (P6-07): non-GET/HEAD `/api/**` requests whose `Origin` doesn't match `Host` → 403. The proxy matcher must then include `/api/**` for that check only.

## C6. Config — `src/lib/app-config.ts` (after P1-02)
`AppConfig` = `{ provider: "local"; defaultModel; downloadDirectory; autoDownload; autoUpdateModels; maxConcurrentDownloads; temperature; contextWindow; allowTelemetry; prompt?: Record<string,string>; allowLiveExecution: boolean (false); queryTimeoutMs: number (30000); defaultEngine: "simulation"|"mssql"|"postgres" ("simulation"); maxSqlLength: number (100000); inferenceTimeoutMs: number (120000); logSqlText: boolean (true, D-028); shareTtlHours: number (24) }`.
- **No `apiKey`.** `defaultModel` = `onnx-community/Qwen2.5-0.5B-Instruct-ONNX` (D-026).
- `readAppConfig()` and `writeAppConfig(partial)` merge onto the **current** config.
- Every server module reads config through `readAppConfig()`, never by parsing `data/appconfig.json` directly. Existing direct readers (`src/lib/installed-models.ts`, `src/app/api/review/route.ts`) migrate as they are touched.

## C7. Validation
- `src/lib/validation/sql-input.ts`: `validateSqlInput(value: unknown, maxLength: number): { ok: true; sql: string } | { ok: false; error: string }`.
- `src/lib/validation/body.ts`: `readJson(request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }>`, plus small guards `isString`, `isNumber`, `isBoolean`. Invalid input → 400 `{ error, field? }`.

## C8. Errors and redaction — `src/lib/redact.ts`
- `redact(value: unknown): unknown` deep-copies and replaces keys matching `/pass(word)?|pwd|token|secret|authorization|cookie|hf_token|api[-_]?key|credential|private[-_]?key|connection/i` with `"[REDACTED]"`.
- `logError(context: string, error: unknown): void` → `console.error(context, redact(...))`.
- Clients get generic messages for 500 (`{ error: "Internal error" }`). Known 4xx messages may be specific.

## C9. Request guard — `src/lib/request-guard.ts`
`rateLimit(key: string, limit: number, windowMs: number): boolean` (in-memory token bucket, single local process, D-008). Client key = socket-level identity only; `X-Forwarded-For` is ignored unless `SQLLENS_TRUST_PROXY=1`. Login also uses a per-username bucket (5/min) and a global bucket (20/min). When the bucket map is full, evict the oldest entries; never clear all of them. Limits: login 5/min per IP, execute 10/min, review 5/min, download 5/min per session. Exceeded → 429.

## C10. Audit persistence — `src/db/audit-repo.ts` (P2-06)
- `insertAudit(input: { sessionId; type: "EXECUTE"|"EXECUTE_COMPARE"|"COMPARE"|"REVIEW"; request: unknown; response: unknown; engine?: string; simulated?: boolean; status?: "ok"|"error"; elapsedMs?: number|null; logicalReads?: number|null; schemaVersion?: string; modelId?: string }): { id: string; recordNumber: number }`
- `getAudit(id, sessionId)` → full record or null. `listAudits(sessionId, limit = 100)` → summaries `{ id, type, createdAt, engine, simulated, status, recordNumber, hasShare }`. `auditStats(sessionId)` → `{ total, completed, averageElapsedMs, totalLogicalReads, recent }` with simulated rows excluded.
- No auto-minted share tokens (P4-06): `shared_token` stays NULL until shared.
- `request` payloads never contain passwords or connection credentials. Store only `engine`, `host`, `database` (not the username).

## C11. Telemetry types — `src/lib/telemetry/types.ts` (P2-01)
`ExecutionStats` numeric fields are `number | null` (null = not captured). It adds `plan?: string | null` (XML or JSON text) and `simulated: boolean`. `StatisticsIORow` keeps its fields, all `number`. Parsers live in `src/lib/telemetry/{mssql,postgres}.ts` and are exported and pure.

## C12. Execution request (P2-05) — `POST /api/execute`
```ts
{ mode: "single" | "compare"; engine: "simulation"|"mssql"|"postgres";
  connection?: { host: string; port?: number; database: string; username: string; password: string; encrypt?: boolean; trustServerCertificate?: boolean };
  original: ExecTarget; optimized?: ExecTarget }
type ExecTarget = { kind: "procedure"; name: string; params: { name: string; type: "int"|"bigint"|"decimal"|"nvarchar"|"varchar"|"bit"|"datetime"|"date"|"uniqueidentifier"; value: string|number|boolean|null }[] }
               | { kind: "batch"; sql: string }   // always executed inside a rolled-back transaction
```
- Identifier pattern for procedure and parameter names: `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$` (params without the dot, optional leading `@`).
- A real engine requires `allowLiveExecution === true`, otherwise 403.
- Response `{ id, recordNumber, result }`, where `result` carries `simulated`.

## C13. Inference — `src/lib/inference.ts` (P3-02, ai-models)
- `generateText(modelDir: string, messages: {role:"system"|"user"; content:string}[], opts: { maxNewTokens: number; temperature: number; timeoutMs: number }): Promise<string>`.
- `getModelStatus(): Record<modelDir, { loaded: boolean; loading: boolean; lastError?: string }>`.
- One generation at a time; a second concurrent call → throws `InferenceBusyError` (route maps to 429). On timeout, throws `InferenceTimeoutError` (route maps to 504).
- Test seam: `setPipelineFactoryForTests(fn)`. Fake mode (D-029): when `SQLLENS_FAKE_INFERENCE === "1"` and `NODE_ENV !== "production"`, it returns a canned valid JSON for the requested schema version.

## C14. Review schema (D-001/D-021) — `src/lib/review-schema.ts`
- `type SchemaVersion = "v1" | "v2"`, default `"v2"`.
- v1 = today's `{ summary, issues[{severity,title,explanation,recommendation}], rewrittenProcedure, confidence }`.
- v2 = `data/prompts/analysisSP.md:58-100`: `{ summary, overallRisk, confidence, findingsTable[], performanceTable[], securityTable[], testingTable[], rewrittenProcedure, limitations[] }`.
- `validateReview(version, value): ReviewV1 | ReviewV2` (throws `Error` with the field path). Prompts: v1 `data/prompts/analysisSP.v1.md`, v2 `data/prompts/analysisSP.md`.
- Review response `{ id, model, schemaVersion, promptPath, result }`.

## C15. Model jobs — `src/lib/model-jobs.ts` (P5-02)
`startDownload({ modelId, sourceUrl, name? }) → { jobId }` · `getJob(jobId)` → `{ jobId, modelId, state: "queued"|"running"|"verifying"|"done"|"failed"|"cancelled", bytesDone, bytesTotal, filesDone, filesTotal, error? }` · `cancelJob(jobId)` · `listJobs()`.
Routes: `POST /api/models/download` (202), `GET|DELETE /api/models/download/[jobId]`, `DELETE /api/models/[id]` (id URL-encoded `owner/repo`).

## C16. Testing (qa owns the harness)
- `tests/setup.ts` sets `SQLLENS_DB_DIR` and `SQLLENS_AUDIT_LOG_DIR` to fresh temp dirs **before** any app import. Tests may import `@/db`, but it only ever opens a temp DB.
- `server-only` is aliased to a no-op stub in `vitest.config.mts`.
- Route tests call exported handlers with `new Request("http://localhost/api/...", { headers: { cookie, origin: "http://localhost" } })`. They mock drivers, inference and network with `vi.mock`, never real services.
- Helper `tests/helpers/auth.ts` → `createTestSession()` returns a cookie header for a seeded admin.

## C17. Audit text logs (sql-engine)
- `audit_logs/` dir = `process.env.SQLLENS_AUDIT_LOG_DIR` or `<cwd>/audit_logs`.
- If `logSqlText` is false, write a SHA-256 and the length instead of the SQL text.
- Never write connection details.
