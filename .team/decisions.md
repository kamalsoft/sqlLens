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
