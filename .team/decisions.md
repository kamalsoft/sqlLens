# SQLLens Decision Queue

Only the user moves a decision to APPROVED or REJECTED. Agents add PROPOSED entries; Scribe records replies verbatim and dates them.
Evidence baseline: `docs/team/discovery.md` @ `22d84fa`.

### D-001 Review output contract
Status: APPROVED
Context (evidence): `data/prompts/analysisSP.md:58-100` vs `src/app/api/review/route.ts:306-361`, `src/app/review/page.tsx:8-22`
Options: A rich prompt schema / B `issues[]` schema / C versioned, both supported
Recommendation: A
Impact if delayed: F3.1, F4.1, F4.3
User decision: C (2026-10-24, "q1 c")

### D-002 Persistence
Status: APPROVED
Context (evidence): `src/db/index.ts:7-50`, `prisma.config.ts:3-6`, `package.json`
Options: A raw better-sqlite3 + versioned SQL migrations / B Prisma / C SQLite, drop Prisma client
Recommendation: A
Impact if delayed: F2.7, F4.5, F4.6, F6.x
User decision: A (2026-10-24, "q2 a")

### D-002b DB file location
Status: APPROVED
Context (evidence): `src/db/index.ts:7` (`../../sqllens_db`, comment "R008")
Options: A keep fixed path / B configurable (env or appconfig), default = current path / C move inside repo (ignored)
Recommendation: B
Impact if delayed: P2 migration tasks
User decision: B (2026-10-24, "yes" to the suggested GATE 2 reply)

### D-003 AI scope
Status: APPROVED
Context (evidence): `src/lib/ai-transformer.ts:166-178`, `src/lib/model-store.ts:14-24`, `src/app/settings/page.tsx:18-19`
Options: A local Transformers.js only / B local + opt-in cloud
Recommendation: A
Impact if delayed: P3, P4
User decision: A (2026-10-24, "q3 a")

### D-004 Simulation mode & execution policy
Status: APPROVED
Context (evidence): `src/lib/sp-executor.ts:138-215`, `docs/configuration.md:14`
Options: A keep, labeled, excluded from compare/persistence; real execution only behind auth + explicit opt-in / B keep as-is / C remove
Recommendation: A
Impact if delayed: P2, P4
User decision: A (2026-10-24, "q4 ok"; confirmed via "yes")

### D-005 Safe execution model
Status: APPROVED
Context (evidence): `src/lib/sp-executor.ts:238-246,272`
Options: A EXEC existing proc + typed params / B arbitrary batch in always-rolled-back transaction / C both, A default
Recommendation: C
Impact if delayed: P2
User decision: C (2026-10-24, "q5 c")

### D-006 Authentication
Status: APPROVED
Context (evidence): `src/app/api/auth/login/route.ts:11-19`
Options: A single local admin, scrypt via `node:crypto` / B multi-user / C external IdP
Recommendation: A
Impact if delayed: P6, DoD 1
User decision: A (2026-10-24, "q6 a")

### D-007 Hugging Face token
Status: APPROVED
Context (evidence): `src/app/api/models/download/route.ts:237`, `data/appconfig.json:10`, `src/app/api/appconfig/route.ts:7`
Options: A `HF_TOKEN` env server-side; remove `apiKey` from JSON + GET / B encrypted store / C keep
Recommendation: A
Impact if delayed: P1.3, P5, P6
User decision: A (2026-10-24, "q7 a")

### D-008 Deployment target
Status: APPROVED
Context (evidence): `README.md:140-144`
Options: A local/self-hosted only / B hosted
Recommendation: A
Impact if delayed: P6 (TLS, rate limit), docs
User decision: A "local" (2026-10-24, "q8 local")

### D-009 Test stack
Status: APPROVED
Context (evidence): `package.json` (no test script), `.storybook/main.js`, `vitest` only transitive via prisma
Options: A Vitest + Testing Library + Playwright + GitHub Actions; drop `.storybook/` / B Node test runner only / C A but keep Storybook
Recommendation: A
Impact if delayed: P7, every task's test requirement
User decision: A (2026-10-24, first reply "q9 sta" unclear; then "yes" to the suggested reply "D-009 A"). Installing the deps is still a separate approval (task P7-01).

### D-010 Repo hygiene
Status: APPROVED (all parts)
Context (evidence): `git status` at session start; `AGENTS.md` "Secrets and Generated Files"
- Untrack `scripts/__pycache__/*.pyc`, ignore `__pycache__/` + `*.pyc`: done 2026-10-24 (staged, not committed)
- Keep uncommitted `src/lib/installed-models.ts` fix: left as-is
- Ignore `audit_logs/`: done 2026-10-24 (`.gitignore`)
- `a.sh`, `.storybook/`, unused modules: leave untouched until a plan task needs them
User decision: "q10 stop tracking the .pyc files and fix" + "yes" (2026-10-24)

### D-011 Roster
Status: APPROVED — `.team/team.md`
User decision: "yes" (2026-10-24)

### D-012 Routing and review rules
Status: APPROVED — `.team/routing.md`
User decision: "yes" (2026-10-24)

### D-013 Layout, folder `.team/`, CLAUDE.md pointer section
Status: APPROVED — `docs/team/team-design.md` §4–5
User decision: "yes" (2026-10-24)

### D-014 Project skills
Status: APPROVED — 11 skills, `sqllens-` prefix, in `.claude/skills/`
User decision: "yes" (2026-10-24)

### D-015 archify skill
Status: APPROVED — keep in `.agents/skills/archify` untouched (hash-locked in `skills-lock.json`)
User decision: "yes" (2026-10-24)

### D-016 Docs/README cleanup scope (was Round-2 Q11)
Status: APPROVED
Context (evidence): `docs/team/discovery.md` §8
Options: A fix every listed contradiction in each task's docs step / B one dedicated docs epic (P0-DOC) / C both: P0-DOC for the existing errors, then per-task updates
Recommendation: C
Impact if delayed: P0-DOC-01..04
User decision: recommendation approved — C (2026-10-24, "Approved")### D-017 `npm` as runtime dependency (was Q12)
Status: APPROVED
Context (evidence): `package.json` dependencies `"npm": "^12.0.2"`
Options: A remove / B keep
Recommendation: A — nothing in `src/` imports it (verify with `rg "from ['\"]npm"` before removal)
Impact if delayed: none blocking (P7-05 hygiene)
User decision: recommendation approved — A — nothing in `src/` imports it (verify with `rg "from ['\"]npm"` before removal) (2026-10-24, "Approved")### D-018 Run `npm run build` for verification (was Q13)
Status: APPROVED
Context (evidence): AGENTS.md "Validation" lists `npm run build`; it writes `.next/` (ignored)
Options: A allowed for QA verification / B ask each time
Recommendation: A
Impact if delayed: acceptance criteria of every task
User decision: recommendation approved — A (2026-10-24, "Approved")### D-019 Exclude `.agents/**` from lint (was Q14)
Status: APPROVED
Context (evidence): `npm run lint` — 51 of 99 problems (1 error, 50 warnings) are in `.agents/`; `eslint.config.mjs:9-14`
Options: A add `.agents/**` to `globalIgnores` / B keep
Recommendation: A
Impact if delayed: P7-04 (CI lint gate)
User decision: recommendation approved — A (2026-10-24, "Approved")### D-020 Migration mechanism details (follows D-002)
Status: APPROVED
Options: A numbered `src/db/migrations/NNN_name.sql` + `schema_migrations` table, applied at startup / B same, applied by an npm script only
Recommendation: A — matches current startup `CREATE TABLE IF NOT EXISTS` behavior (`src/db/index.ts:17`)
Impact if delayed: P2-06, P4-05, P4-06, P6-01
User decision: recommendation approved — A — matches current startup `CREATE TABLE IF NOT EXISTS` behavior (`src/db/index.ts:17`) (2026-10-24, "Approved")### D-021 Review schema versioning shape (follows D-001)
Status: APPROVED
Options: A request field `schemaVersion: "v1" | "v2"` (v1 = `issues[]`, v2 = prompt tables), default v2 / B separate prompt files per version, chosen by appconfig
Recommendation: A, with prompt file per version
Impact if delayed: P3-01, P4-01
User decision: recommendation approved — A, with prompt file per version (2026-10-24, "Approved")### D-022 DB directory setting name (follows D-002b)
Status: APPROVED
Context (evidence): `src/db/index.ts:7`
Options: A env `SQLLENS_DB_DIR` / B `appconfig.databaseDirectory` / C both, env wins
Recommendation: A — the DB opens at import time, before appconfig is read
Impact if delayed: P0-03 and everything after it
User decision: recommendation approved — A — the DB opens at import time, before appconfig is read (2026-10-24, "Approved")### D-023 Max SQL input length default
Status: APPROVED
Context (evidence): only limit today is 30,000-char prompt cap (`src/app/api/review/route.ts:69`)
Options: A 100,000 chars / B 30,000 chars / C 1,000,000 chars
Recommendation: A, configurable via `maxSqlLength`; review still bounded by the prompt/context check (P3-02)
Impact if delayed: P1-06
User decision: recommendation approved — A, configurable via `maxSqlLength`; review still bounded by the prompt/context check (P3-02) (2026-10-24, "Approved")### D-024 PostgreSQL telemetry approach
Status: APPROVED
Context (evidence): `src/lib/sp-executor.ts:272` (`EXPLAIN ANALYZE ${sp}` is not valid for `CALL`/`CREATE`) `[UNVERIFIED]`
Options: A `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` only for SELECT/function calls and batch statements; procedures report timing only / B `auto_explain` session settings (needs superuser or preload) / C `pg_stat_statements` before/after deltas (needs the extension)
Recommendation: A first, B/C as documented options later
Impact if delayed: P2-03, DoD 4–5 for PostgreSQL
User decision: recommendation approved — A first, B/C as documented options later (2026-10-24, "Approved")### D-025 Share-link access model
Status: APPROVED
Context (evidence): `src/app/api/share/[token]/route.ts:10` (public, no expiry)
Options: A anyone with the link until expiry / B login required + link / C disable sharing for local deployment
Recommendation: B — single local admin (D-006) makes A an unauthenticated data-exposure path
Impact if delayed: P4-06, P4-07
User decision: recommendation approved — B — single local admin (D-006) makes A an unauthenticated data-exposure path (2026-10-24, "Approved")### D-026 Default model
Status: APPROVED
Context (evidence): `src/lib/app-config.ts:20` + `data/appconfig.json:3` = `microsoft/Phi-3-mini-4k-instruct` (no ONNX in that repo per refresh catalog); installed: `onnx-community/Qwen2.5-0.5B-Instruct-ONNX`
Options: A default = `onnx-community/Qwen2.5-0.5B-Instruct-ONNX` / B no default; the user picks after download
Recommendation: A
Impact if delayed: P5-06, P1-02 defaults
User decision: recommendation approved — A (2026-10-24, "Approved")### D-027 Admin bootstrap
Status: APPROVED
Context (evidence): D-006; no users today except auto-created ones (`src/app/api/auth/login/route.ts:14-19`)
Options: A first-run setup page (only while no admin exists) / B env `SQLLENS_ADMIN_PASSWORD` read on first start / C npm script that prompts for the password
Recommendation: C — no secret in env or the network path; A is the friendlier alternative
Impact if delayed: P6-01 → all of Phase 6, DoD 1
User decision: recommendation approved — C — no secret in env or the network path; A is the friendlier alternative (2026-10-24, "Approved")### D-028 SQL text in `audit_logs/`
Status: APPROVED
Context (evidence): `src/lib/sp-executor.ts:105-106` (full SP written), now git-ignored
Options: A keep full SQL (local, user's own data) / B store hash + length only / C config flag, default A
Recommendation: C
Impact if delayed: P6-06
User decision: recommendation approved — C (2026-10-24, "Approved")### D-029 E2E inference strategy
Status: APPROVED
Context (evidence): rule "tests use no model weights" (`.claude/skills/sqllens-testing-conventions`)
Options: A test-only fake inference enabled by env `SQLLENS_FAKE_INFERENCE=1`, rejected when NODE_ENV=production / B run the real 0.5B Qwen ONNX model in E2E (slow; weights in CI)
Recommendation: A
Impact if delayed: P7-05
User decision: recommendation approved — A (2026-10-24, "Approved")### D-030 Inference timeout default
Status: APPROVED
Context (evidence): only `maxDuration = 300` (`src/app/api/review/route.ts:10`)
Options: A 120 s / B 300 s / C none
Recommendation: A, configurable via `inferenceTimeoutMs`
Impact if delayed: P3-06
User decision: recommendation approved — A, configurable via `inferenceTimeoutMs` (2026-10-24, "Approved")### D-031 `/api/compare` ownership moves to ai-models
Status: APPROVED
Context (evidence): `.team/team.md` (backend owns compare); P4-02 turns it into an inference route
Options: A move to ai-models when P4-02 starts / B keep with backend; ai-models supplies a lib function
Recommendation: A
Impact if delayed: P4-02
User decision: recommendation approved — A (2026-10-24, "Approved")### D-032 P0-01 test-stack versions
Status: APPROVED
Context (evidence): `package.json` devDependencies; `@types/node` 20.19.43 installed (`"^20"`); vitest 5.x peer `@types/node ^22 || >=24`; npm audit flagged nested vite 8.2.2 (GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22 and 4 others, fixed after 8.2.3)
Options: A vitest 4.1.11 + direct devDep `vite` 8.3.4 (current) / B vitest 5.0.3 + bump `@types/node` to ^22 / C A now, B in a later task
Recommendation: A — no change to existing type packages; every pin is ≥14 days old. (An npm `overrides` entry hit an npm bug, "Cannot read properties of null (reading 'edgesOut')", so vite is a direct pin.)
Impact if delayed: none (reversible)
User decision: recommendation approved — A — no change to existing type packages; every pin is ≥14 days old. (An npm `overrides` entry hit an npm bug, "Cannot read properties of null (reading 'edgesOut')", so vite is a direct pin.) (2026-10-24, "Approved")
### D-033 Prisma leftovers
Status: APPROVED
Context (evidence): `prisma.config.ts:3-6` (configures only `prisma skills sync`); `package.json` `postinstall: prisma skills sync || exit 0`; `prisma` 8.0.0-rc.12 (dev) and `@prisma/client` 7.10.0 (runtime, not imported in `src/`). Persistence is raw SQLite (D-002). The prisma toolchain accounts for several pre-existing audit findings (`@prisma/composer-cli`, `alchemy`, `@prisma/dev`).
Options: A remove `@prisma/client`, `prisma`, `prisma.config.ts` and the postinstall / B remove only `@prisma/client`, keep the skill sync / C keep everything
Recommendation: A — nothing uses it; it reduces dependencies and audit findings and stops postinstall writing into `.claude/skills`. Do it as a new hygiene task, P7-10, which needs approval for the package changes.
Impact if delayed: none blocking
User decision: A, as recommended. Executed via task P7-10. (2026-10-24, reply "1, 2, 3")

### D-034 MSSQL batch COMMIT bypass via dynamic SQL
Status: APPROVED
Context (evidence): security part 2 (2026-10-25), Medium. `src/lib/execution/sql-scan.ts:86` masks string literals before the COMMIT/ROLLBACK check, so `EXEC('COMMIT')`, `sp_executesql N'COMMIT'` or calling a committing procedure inside an MSSQL batch commits the outer transaction (breaks D-005 "a batch never commits"). PostgreSQL is not affected.
Options: A reject `EXEC`/`EXECUTE`/`sp_executesql` in MSSQL batches (procedure mode still runs procedures) / B open the batch with nested `BEGIN TRAN` ×2 and check `@@TRANCOUNT` after; report an error if it dropped (one stray COMMIT stays rolled back; repeated COMMITs are detected but not undone) / C A + B
Recommendation: C — A blocks the known paths; B is defense in depth for anything the scanner misses
Impact if delayed: D-005 guarantee for SQL Server batches; security sign-off on SQL execution
User decision: C (A + B), as recommended (2026-10-25)

### D-035 Review quality with Qwen2.5-0.5B
Status: APPROVED
Context (evidence): lead experiments 2026-10-25 on the user's 4 KB procedure (scratchpad, not committed). v2, 1536 tokens: the model loops on one row until the limit (129 s, truncated JSON) and copies the prompt example rows. v2 + repetition_penalty 1.15 + "max 5 rows" rule: closes the JSON early, but every evidence string is invented and values fall outside the enums. v1: 7–10 s, short, generic, and invents a "SQL injection" issue the procedure doesn't have.
Options: A use a larger ONNX instruct model as the default (e.g. a 1.5B–3B Qwen2.5 ONNX build; download size and CPU time grow about 3–6×; the repo ID must pass the P5-01 preflight) / B keep 0.5B, default to schema v1, and label results "low-confidence small model" / C both: v1 for models under 1B, v2 offered for larger ones
Recommendation: C
Impact if delayed: DoD review quality; P5-06 catalog and default model (D-026)
User decision: C (both), as recommended (2026-10-25)

### D-036 Allow transaction control in batch scripts (supersedes D-005 batch rule and D-034 B)
Status: APPROVED
Context (evidence): live run on 2026-11-10 returned "Transaction control statements are not allowed in a batch" for a stored procedure script (`src/lib/execution/request.ts:59`, `src/lib/execution/sql-scan.ts:77`). The user states that database scripts are expected to contain COMMIT/ROLLBACK and BEGIN.
Options: A allow transaction control in MSSQL and PostgreSQL batches, keep the wrapper transaction (uncommitted work still rolls back) and keep the D-034 A ban on dynamic EXEC / sp_executesql / B remove the rejection and the D-034 @@TRANCOUNT guard too, leave no wrapper / C keep the check and add an opt-in per request
Recommendation: A, with the D-034 A dynamic-exec ban kept. Risk: a script can commit changes, so scripts can write to the database. Anonymous `/api/execute` access is still possible until P2-05 (auth).
Impact if delayed: none blocking. Blocks the user's script runs.
User decision: A (2026-11-10, "I signoff the change request and approve it. go ahead and make the change"). Security sign-off was given by the user, not by the security agent review; the security review still needs to run.
Security review (2026-11-10, verdict APPROVED WITH CONDITIONS): condition 2 (PostgreSQL `PREPARE TRANSACTION` is no longer blocked) is an accepted risk until the PostgreSQL feature is removed (ROADMAP backlog item 21). User accepted the risk (2026-11-10, "yes"). Conditions 1, 3 and 4 are met: auth on `/api/execute` is verified, the stale comments are fixed, and `data/appconfig.json` stays out of the PR.

### D-037 Prod-readiness verdict for stored procedure runs
Status: APPROVED (option C: P8-02 verdict now, P8-03 multi-run later)
Context (evidence): live run 2026-11-11 reported grade A from elapsed time alone while logical reads, physical reads and scan count were "Not captured" (`src/lib/audit-analyzer.ts`, grade from time only). The user needs evidence to decide "ready for prod" or "optimize first".
Options:
A Verdict from measured evidence only: `READY` / `OPTIMIZE` / `INSUFFICIENT EVIDENCE`, against user-set thresholds (max logical reads, max elapsed, max scans). Multi-run statistics added later (P8-03).
B Keep grades (A to F) but grade only when I/O and time are both captured. No thresholds.
C Option A now, with P8-03 (multi-run) deferred.
Recommendation: C. It stops false "A" grades now and gives a decision basis. Multi-run is the highest-risk part (repeated execution) and needs its own authorization.
Impact if delayed: the user cannot take a prod-readiness decision from the app; grades can mislead.
User decision: C (2026-11-11, "APPROVED: start P8-02"). Thresholds are not set yet; until they are, the verdict is `INSUFFICIENT EVIDENCE: no targets set`. P8-03 (repeated execution) is not approved.

### D-038 Windows authentication for MSSQL connections
Status: APPROVED (option A: NTLM now)
Context (evidence): the user wants Windows authentication as the final option for SQL Server connections. Today `ExecConnection` only carries SQL logins (`username` and `password`, `src/lib/execution/types.ts`), and `buildMssqlConfig` passes them to `mssql`. The app runs on macOS, where SSPI (Integrated Security) is not available.
Options:
A NTLM via `mssql`'s `authentication: { type: 'ntlm' }`, with `domain`, `username` and `password` in the request. Works from macOS and Linux against a Windows-hosted SQL Server. Adds a `domain` field.
B Integrated Security (SSPI) through the Windows-only `msnodesqlv8` driver. Needs a Windows host and a new native dependency.
C A and B: NTLM everywhere, SSPI when the app runs on Windows.
Recommendation: A now, since it covers the current macOS setup without a new native dependency. B later only if the app is hosted on Windows.
Constraints: the password is never persisted or logged (existing rule). Kerberos is out of scope. Security sign-off is required (auth and credentials).
Impact if delayed: the user cannot connect to Windows-authenticated SQL Server instances.
User decision: A (2026-11-11). P9-01 is not started; it needs `APPROVED: start P9-01`.

### D-039 Empty-table check for P8-02 (replaces the TableCardinality rule)
Status: APPROVED (option 1). Implemented 2026-11-11 under `APPROVED: start P8-02-count`; Security sign-off still required before merge.
Context (evidence): run 2026-11-11 (record 56) read 1,000,000 `Customers` rows (`ActualRows`) while the plan's `TableCardinality` said 0. The compile-time value is stale, so the rule gave a false `INSUFFICIENT EVIDENCE: Customers has 0 rows`. The rule was removed from `src/lib/audit-analyzer.ts` the same day.
Options: 1 read-only `SELECT COUNT(*)` per real table on the same connection before the run / 2 runtime `ActualRows` only / 3 remove the check.
User decision: 1 (2026-11-11, reply "1").
Deviation: row counts come from `sys.partitions` (parameterized table names), not `COUNT(*)`, so no table name enters the SQL text. Exact for committed rows; in-transaction changes are not verified (see the shortcut comment in `src/lib/execution/mssql.ts`).
Constraints: the query text is fixed in code. Table names come from the server's STATISTICS IO messages, which a script can fake with PRINT or RAISERROR; they must match an identifier pattern, are bound as parameters, and the count is schema-blind (same-name tables in two schemas are summed). Security review 2026-11-11: low risk, no injection path found; it runs inside the existing connection and timeout; it is read-only; it is a new SQL execution path, so Security sign-off is required.

### Security review 2026-11-11 (commits 8ecdb20, 23b7b4f, 0a4b43b)
Status: APPROVED WITH CONDITIONS (read-only review by the security agent; not a merge approval)
- C1 OPEN, needs a user decision: OUTPUT values are stored in the audit DB response and in the audit log file, whatever `logSqlText` says. In mssql an OUTPUT parameter is INOUT, so a caller's input value can come back and be stored. Options: A stop storing `outputs` (show them in the response only) / B keep and record an accepted risk.
- C2 done: D-039 wording corrected above.
- C3: `data/appconfig.json` stays out of every commit.
Not verified: no live MSSQL run of the count query or the GO edge cases.
