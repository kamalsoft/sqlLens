# SQLLens Squad — Roster (D-011, APPROVED 2026-10-24)

Human lead: the user (sole decision authority). Agents propose; the user approves.
Subagent definitions: `.claude/agents/<id>.md`. Skills: `.claude/skills/sqllens-*`.

| ID | Role | Owns (write) | Forbidden (write) | Model |
|---|---|---|---|---|
| lead | Lead / Architect | `docs/architecture.md`, `docs/ROADMAP.md`, `docs/team/plan.md`; `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` (user approval required) | `src/**` | opus |
| frontend | Frontend | `src/app/**/page.tsx`, `src/app/layout.tsx`, `src/app/providers.tsx`, `src/app/globals.css`, `src/components/**` | `src/app/api/**`, `src/lib/**`, `src/db/**`, `scripts/**`, `data/**` | sonnet |
| backend | Backend / API | `src/app/api/{auth,appconfig,audit,share,analysis,compare}/**`, `src/db/**` (incl. migrations), `src/lib/app-config.ts`, `data/appconfig.json`, `src/proxy.ts`, new `src/lib/auth*.ts` | `src/lib/sp-executor.ts`, `src/lib/audit-analyzer.ts`, review/model code, pages | sonnet |
| sql-engine | SQL Engine & Telemetry | `src/lib/sp-executor.ts`, `src/lib/audit-analyzer.ts`, new `src/lib/telemetry/**`, `src/app/api/execute/**`, new `src/app/api/connections/**` | auth, models, pages, `src/db/**` | sonnet |
| ai-models | AI / Models | `src/app/api/review/**`, `src/app/api/models/**`, `src/lib/{ai-transformer,installed-models,huggingface-download,validate-model,model-*}.ts`, `data/prompts/**`, `scripts/validate_and_download_model.py` | auth, `src/db/**`, pages, `downloads/models/**` contents | sonnet |
| qa | QA | test files and test config (D-009), `.github/workflows/**` | production code in `src/**`, `scripts/**` | sonnet |
| security | Security Reviewer | `.team/agents/security/history.md` only (read-only reviewer) | everything else | opus |
| scribe | Scribe (silent) | `.team/**`, `docs/team/**`, `.claude/skills/sqllens-*/**`; `docs/*.md`, `README.md` only after the user approves the diff | `src/**`, `scripts/**`, `data/**`, configs | haiku |

Rules
- One owner per file; others request changes through the owner.
- `package.json` / `package-lock.json`, `.env*`, schema/migration, DB connection, model download, git commit/push need a user-APPROVED decision first.
- Unused modules (`src/lib/datadog-analyzer.ts`, `model-store.ts`, `model-validation.ts`, `model-path.ts`, `src/components/layout/Navbar.tsx`) are owned by their area but stay untouched until a task needs them (D-010).
