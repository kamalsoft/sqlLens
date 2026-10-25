# SQLLens Squad — Team Design (GATE 2 proposal)

Status: **APPROVED at GATE 2 (2026-10-24)**. Superseded by `.team/team.md`, `.team/routing.md`, `.team/decisions.md` — kept for history.
Evidence base: `docs/team/discovery.md` (baseline `22d84fa`).
Staging note: the decision log lives below until the team folder name (D-013) is approved; Scribe then moves it to `<team>/decisions.md` unchanged.

## 1. Roster (D-011)

| Role | Owns (write) | Forbidden (write) | Skills used | Model tier |
|---|---|---|---|---|
| **Lead / Architect** | `docs/architecture.md`, `docs/ROADMAP.md`, `docs/team/plan.md`, `package.json` + configs (`next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`) — dependency/config edits only with user approval | `src/**` (reviews, does not author) | sqllens-architecture, nextjs-conventions, decision-log | opus |
| **Frontend** | `src/app/**/page.tsx`, `src/app/layout.tsx`, `src/app/providers.tsx`, `src/app/globals.css`, `src/components/**` | `src/app/api/**`, `src/lib/**`, `src/db/**`, `scripts/**`, `data/**` | nextjs-conventions, sqllens-architecture, testing-conventions | sonnet |
| **Backend / API** | `src/app/api/{auth,appconfig,audit,share,analysis,compare}/**`, `src/db/**`, `src/lib/app-config.ts`, future migrations dir, future auth proxy/middleware | `src/lib/sp-executor.ts`, `src/lib/audit-analyzer.ts`, model/review code, UI pages | api-route-patterns, nextjs-conventions, security-redaction | sonnet |
| **SQL Engine & Telemetry** | `src/lib/sp-executor.ts`, `src/lib/audit-analyzer.ts`, `src/app/api/execute/**`, future connection-test route | auth, model, UI, `src/db/**` schema (requests changes via Backend) | sql-execution-mssql-pg, telemetry-parsing, security-redaction | sonnet |
| **AI / Models** | `src/app/api/review/**`, `src/app/api/models/**`, `src/lib/{ai-transformer,installed-models,huggingface-download,validate-model,model-*}.ts`, `data/prompts/**`, `scripts/validate_and_download_model.py` | auth, `src/db/**`, UI pages, `downloads/models/**` content | transformers-local-inference, model-management, api-route-patterns | sonnet |
| **QA** | test files + test config (location per D-009), `.github/workflows/**` | production code under `src/**`, `scripts/**` | testing-conventions, sqllens-architecture | sonnet |
| **Security Reviewer** | review notes only (`<team>/agents/security/history.md`) | all source/config/docs (read-only role) | security-redaction, sql-execution-mssql-pg, api-route-patterns | opus |
| **Scribe** (silent) | `<team>/**`, `docs/team/**`, `.claude/skills/**` fact updates, `docs/*.md` + `README.md` **only after the user approves a diff** | `src/**`, `scripts/**`, `data/**`, configs | docs-sync, decision-log | haiku |

Shared-file rule: a file has exactly one owner; others request changes via the owner. `package.json` / `package-lock.json` changes always need a user APPROVED decision (AGENTS.md "Stop and ask before installing").

## 2. Routing (D-012a)

| Task type | Primary | Reviewer |
|---|---|---|
| Page/form/loading-error UI | Frontend | Backend (API contract) |
| Route handler, request validation, DB schema/migration | Backend | Lead |
| Auth, sessions, CSRF, rate limit, share expiry | Backend | **Security** |
| SQL execution, connection, timeouts, parsers | SQL Engine | **Security** (execution) + QA (parsers) |
| Review/compare inference, prompts, JSON validation | AI/Models | Lead |
| Model download/validation/delete | AI/Models | **Security** (network/fs) |
| Tests, CI | QA | owner of code under test |
| Docs, README, decisions, skills | Scribe | Lead |
| Cross-area / architectural | Lead (plans) → area owners | user |

## 3. Review rules (D-012b)

1. Author ≠ reviewer, always.
2. **Security sign-off is mandatory** for any change touching: auth/sessions, credentials/tokens, SQL execution, share links, outbound network (HF), file-system writes outside `audit_logs/`/models dir, logging of SQL/request bodies.
3. QA confirms each task's binary acceptance criteria and that `npm run lint`, `npx tsc --noEmit`, `npm run build` (once D-R2-Q13 approved) and tests pass.
4. Agents propose; only the user flips a decision to APPROVED. Implementation of a task starts only on `APPROVED: start <task ID>`.
5. No git commit/push/branch by any agent without explicit user instruction.

## 4. File layout (D-013)

```text
.claude/
  agents/<role>.md          # frontmatter: name, description (when to route), tools, model; body ≤30-line charter linking skills
  skills/sqllens-<name>/SKILL.md (+ references/*.md)
<team>/                     # proposed name: .team/  (alt: .squad/)
  team.md                   # roster (from §1)
  routing.md                # §2 + §3
  decisions.md              # Decision Queue (moved from §6 below)
  now.md                    # current focus / next task
  agents/<role>/history.md  # per-role learnings
  log/YYYY-MM-DD.md         # session log (Scribe)
docs/team/                  # discovery.md, team-design.md, plan.md
CLAUDE.md                   # keep "@AGENTS.md" + ≤15-line pointer section (draft §5)
```

Coexistence facts:
- `.claude/skills/` already exists (empty) and is a `prisma skills sync` target (`prisma.config.ts:4`, `package.json` postinstall). Prefixing ours `sqllens-` avoids collisions. (D-014)
- `.agents/skills/archify` + `skills-lock.json`: third-party diagram skill, unrelated to app facts → keep as-is, not mirrored or edited. (D-015)
- `AGENTS.md` token governance stays authoritative; charters reference it instead of restating it.
- All of `.claude/agents`, `.claude/skills/sqllens-*`, `<team>/` are tracked in git (squad pattern).

## 5. Draft CLAUDE.md pointer section (D-013b)

```markdown
@AGENTS.md

## SQLLens Squad
- Team roster & ownership: `.team/team.md`; routing & review rules: `.team/routing.md`
- Decisions (only the user approves): `.team/decisions.md`; current focus: `.team/now.md`
- Plan & task IDs: `docs/team/plan.md`; evidence baseline: `docs/team/discovery.md`
- Subagents: `.claude/agents/`; project skills: `.claude/skills/sqllens-*`
- Start work only on "APPROVED: start <task ID>". Author ≠ reviewer; Security signs off on auth, credentials, SQL execution, model downloads.
```

## 6. Decision log (staged)

### D-001 Review output contract
Status: APPROVED
Context (evidence): `data/prompts/analysisSP.md:58-100` vs `src/app/api/review/route.ts:306-361`
Options: A rich prompt schema / B `issues[]` schema / C versioned both
Recommendation: A
Impact if delayed: F3.1, F4.1, F4.3
User decision: C — versioned, both supported (2026-10-24)

### D-002 Persistence
Status: APPROVED
Context: `src/db/index.ts:7-50`, `prisma.config.ts`, `package.json`
Options: A raw better-sqlite3 + versioned SQL migrations / B Prisma / C SQLite, drop Prisma client
Recommendation: A
Impact if delayed: F2.7, F4.5, F4.6, F6.x
User decision: A (2026-10-24)

### D-002b DB file location
Status: PROPOSED
Context: `src/db/index.ts:7` (`../../sqllens_db`, comment "R008")
Options: A keep fixed path / B configurable (env or appconfig), default current path / C move inside repo (ignored)
Recommendation: B — keeps current data, removes cwd dependence
Impact if delayed: migration tasks (Phase 2/6)
User decision: _pending_

### D-003 AI scope
Status: APPROVED
Context: `src/lib/ai-transformer.ts:166-178`, `src/lib/model-store.ts:14-24`, `settings/page.tsx:18-19`
Options: A local Transformers.js only / B local + opt-in cloud
User decision: A (2026-10-24)

### D-004 Simulation mode & execution policy
Status: APPROVED (interpretation — please confirm)
Context: `src/lib/sp-executor.ts:138-215`, `docs/configuration.md:14`
Options: A keep, labeled, excluded from compare/persistence; execution only behind auth + explicit opt-in / B keep as-is / C remove
User decision: "ok" → recorded as A (2026-10-24)

### D-005 Safe execution model
Status: APPROVED
Context: `src/lib/sp-executor.ts:238-246,272`
Options: A EXEC existing proc + typed params / B arbitrary batch in always-rolled-back transaction / C both, A default
User decision: C (2026-10-24)

### D-006 Authentication
Status: APPROVED
Context: `src/app/api/auth/login/route.ts:11-19`
Options: A single local admin, scrypt via `node:crypto` / B multi-user / C external IdP
User decision: A (2026-10-24)

### D-007 Hugging Face token
Status: APPROVED
Context: `src/app/api/models/download/route.ts:237`, `data/appconfig.json:10`, `src/app/api/appconfig/route.ts:7`
Options: A `HF_TOKEN` env server-side; remove `apiKey` from JSON + GET / B encrypted store / C keep
User decision: A (2026-10-24)

### D-008 Deployment target
Status: APPROVED
Context: `README.md:140-144`
Options: A local/self-hosted only / B hosted
User decision: A local (2026-10-24). README Vercel section removal → docs task (diff needs approval).

### D-009 Test stack
Status: PROPOSED — answer "sta" unclear
Context: `package.json` (no test script), `.storybook/main.js`
Options: A Vitest + Testing Library + Playwright + GitHub Actions; drop `.storybook/` / B Node test runner only / C A but keep Storybook
Recommendation: A
Impact if delayed: all Phase 7 tasks, test requirements of every task
User decision: _pending clarification_

### D-010 Repo hygiene
Status: PARTIALLY APPROVED
Context: `git status` at session start; `AGENTS.md` Secrets section
- Untrack `scripts/__pycache__/*.pyc` + ignore `__pycache__/`, `*.pyc` — APPROVED, executed (staged `git rm --cached`; files kept on disk; `.gitignore` +3 lines; not committed)
- Keep uncommitted `src/lib/installed-models.ts` fix — APPROVED ("fix"), left as-is
- Ignore `audit_logs/` (contains SP text) — PROPOSED, recommend yes
- `a.sh` (scratch), `.storybook/` (see D-009), unused modules (`datadog-analyzer.ts`, `model-store.ts`, `model-validation.ts`, `model-path.ts`, `layout/Navbar.tsx`) — PROPOSED: leave untouched until a plan task needs them
User decision: _pending for the PROPOSED parts_

### D-011 Roster — §1. Status: PROPOSED. User decision: _pending_
### D-012 Routing (a) & review rules (b) — §2–3. Status: PROPOSED. User decision: _pending_
### D-013 Layout (a), team folder name `.team/` (b), CLAUDE.md section (c) — §4–5. Status: PROPOSED. User decision: _pending_

### D-014 Project skills (Phase 2 set)
Status: PROPOSED
Options: create, `sqllens-` prefixed: architecture, nextjs-conventions, sql-execution-mssql-pg, telemetry-parsing, transformers-local-inference, model-management, api-route-patterns, testing-conventions (after D-009), security-redaction, docs-sync, decision-log
Recommendation: all 11; merge decision-log into docs-sync if you want fewer
User decision: _pending_

### D-015 archify skill
Status: PROPOSED
Options: A keep in `.agents/skills` untouched / B also expose under `.claude/skills`
Recommendation: A — not app knowledge; avoids editing a hash-locked third-party skill (`skills-lock.json`)
User decision: _pending_
