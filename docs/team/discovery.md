# SQLLens — Phase 0 Discovery

- Baseline commit: `22d84fa` (branch `main`), discovered 2026-10-24
- Method: read-only. `rg`/`grep`/`sed` line ranges, `npx --no-install tsc --noEmit`, `npm run lint`. No network, DB, model load, or installs.
- Legend: **Done** = implemented in code (runtime still unverified unless stated) · **Partial** · **Mock** · **Missing** · **Broken** · `[UNVERIFIED]` = needs runtime/DB/model to confirm → linked to a question.

## 1. Stack and exact versions (installed, from `node_modules/*/package.json`)

| Package | Declared (`package.json`) | Installed |
|---|---|---|
| next | 16.3.3 | 16.3.3 |
| react / react-dom | 19.2.8 | 19.2.8 |
| @huggingface/transformers (Transformers.js) | ^4.2.0 | 4.2.0 |
| mssql | ^12.7.0 | 12.7.0 |
| pg | ^8.23.0 | 8.23.0 |
| better-sqlite3 | ^13.0.3 | 13.0.3 |
| @chakra-ui/react | ^3.37.0 | 3.37.0 |
| prisma (CLI, dev) | ^8.0.0-rc.12 | 8.0.0-rc.12 |
| @prisma/client | ^7.10.0 | 7.10.0 (major mismatch with CLI; unused in `src/`) |
| typescript | ^5 | 5.9.3 |
| eslint / eslint-config-next | ^9 / 16.3.3 | 9.39.5 |
| tailwindcss | ^4.3.3 | 4.3.3 |
| npm (as a runtime dependency) | ^12.0.2 | — (unusual; `package.json` dependencies) |

Runtime: Node v22.23.2 (local). Python venv `.venv/` is py3.9; committed `scripts/__pycache__/*.cpython-314.pyc` implies py3.14 was also used.
Scripts (`package.json`): `dev`, `build`, `start`, `lint`, `cleanStart` (does `rm -rf .next`), `postinstall: prisma skills sync`. **No `test` or `typecheck` script.**

## 2. Directory map

| Path | Purpose | Tracked |
|---|---|---|
| `src/app/` | App Router pages + `api/` route handlers (App Router lives in `src/app`, not `app/`) | yes |
| `src/components/` | `AppShell.tsx` (sidebar shell), `review/ReviewPanel.tsx`, `layout/Navbar.tsx` (unused) | yes |
| `src/lib/` | Engine, parsers, analyzers, model discovery/download/validation, config IO | yes |
| `src/db/index.ts` | better-sqlite3 connection + inline `CREATE TABLE IF NOT EXISTS` schema | yes |
| `data/appconfig.json` | Runtime config (incl. `apiKey` field — currently empty) | yes |
| `data/prompts/` | `analysisSP.md` (used), `analysisSP-verylarge.md` (unused), `explainStatistic.md` (0 bytes) | yes |
| `docs/` | 11 markdown docs (see §8) | yes |
| `scripts/validate_and_download_model.py` | Python HF downloader/validator (stdlib only) | yes (+ `__pycache__` committed) |
| `downloads/models/` | Local models (one: `onnx-community_Qwen2.5-0.5B-Instruct-ONNX`) | ignored (`.gitignore:43`) |
| `audit_logs/` | Execution text logs incl. full SP source (3 files) | **untracked, not ignored** |
| `.agents/skills/archify/` | Third-party diagram skill (`skills-lock.json` → `tt-a1i/archify`) | yes |
| `.claude/skills`, `.cursor/skills`, `.devin/skills` | Empty dirs — targets of `prisma.config.ts` skill sync | no (empty) |
| `.storybook/` | Storybook config; no storybook deps, no stories | untracked |
| `a.sh` | Scratch script; lines 62+ are a pasted TS fragment (not valid bash) | untracked |
| `keys.md` | Secrets file — **not read** | ignored (`.gitignore:44`) |
| `../../sqllens_db/sqllens.db` | SQLite DB, **outside the repo** (`src/db/index.ts:7`) | n/a |

## 3. API route map

No `middleware`/`proxy` file exists → **no route is protected**. "Session-aware" = reads `session_token` cookie but falls back to `anonymous`.

| Method | Path | Handler | Auth | Status | Evidence |
|---|---|---|---|---|---|
| GET | `/api/analysis` | `src/app/api/analysis/route.ts` | none | **Mock** — hardcoded empty array | `analysis/route.ts:4-12` |
| POST | `/api/analysis` | same | none | **Broken** — server-side relative `fetch("/api/analysis")` | `analysis/route.ts:43` |
| GET/PUT | `/api/appconfig` | `appconfig/route.ts` | none | Done; GET returns `apiKey` to client; PUT has no validation | `appconfig/route.ts:7,14-19` |
| GET | `/api/audit` | `audit/route.ts` | cookie (empty list if none) | Done (list only); **no UI caller** | `audit/route.ts:10-21` |
| POST | `/api/auth/login` | `auth/login/route.ts` | n/a | **Mock** — any username auto-created, password ignored | `auth/login/route.ts:11-19` |
| POST | `/api/auth/logout` | `auth/logout/route.ts` | cookie | Done | `auth/logout/route.ts:10-13` |
| GET | `/api/auth/me` | `auth/me/route.ts` | cookie | Done | `auth/me/route.ts:14-31` |
| POST | `/api/compare` | `compare/route.ts` | anonymous fallback | **Mock** AI (regex heuristics) + persisted | `compare/route.ts:25`, `lib/ai-transformer.ts:175-178` |
| POST | `/api/execute` | `execute/route.ts` | anonymous fallback | Partial (see Phase 2) | `execute/route.ts:53-93` |
| POST | `/api/models/download` | `models/download/route.ts` | none | Partial (no progress/cancel/dup-check) | `models/download/route.ts:209-305` |
| GET | `/api/models/refresh` | `models/refresh/route.ts` | none | Done (fs scan + hardcoded catalog) | `models/refresh/route.ts:21-70,110-166` |
| GET | `/api/review/models` | `review/models/route.ts` | none | Done | `review/models/route.ts:6-9` |
| POST | `/api/review` | `review/route.ts` | none | Real Transformers.js; **schema mismatch → likely always 502** `[UNVERIFIED]` | `review/route.ts:2,94,317` vs `data/prompts/analysisSP.md:58-100` |
| GET | `/api/share/[token]` | `share/[token]/route.ts` | **none, no expiry** | Done | `share/[token]/route.ts:10` |

Pages: `/` (overview), `/review`, `/execute`, `/compare`, `/manage-models`, `/settings` (not in nav: `AppShell.tsx:11` commented out), `/share/[token]`. **No login page.**

## 4. Data model (SQLite via better-sqlite3, raw SQL — `src/db/index.ts:17-50`)

- `users(id, username UNIQUE, password_hash, created_at)` — hash is literal `'simulated_hash'` (`auth/login/route.ts:17`)
- `sessions(id, user_id→users, token UNIQUE, is_active, created_at, last_accessed_at)` — no expiry check
- `app_config(id, key UNIQUE, value)` — **unused** (config lives in `data/appconfig.json`)
- `audit_requests(id, session_id→sessions, type, request_payload, response_payload, shared_token UNIQUE, created_at)` — types `EXECUTE`, `EXECUTE_COMPARE`, `COMPARE`; `/api/review` does **not** persist
- No migrations, no Prisma schema. `prisma.config.ts:3-6` only configures `skills.agents` for `prisma skills sync`. `@prisma/client` is not imported anywhere in `src/`.
- File store: `audit_logs/<000NNN>_<label>_<ts>.txt`, record number from `readdir` max+1 (`lib/sp-executor.ts:74-79`, race-prone); header comment claims the number is stored in SQLite (`sp-executor.ts:12`) — it is not.

## 5. Environment variables (names only)

| Name | Where | Note |
|---|---|---|
| `NODE_ENV` | `auth/login/route.ts:31` | cookie `secure` flag |
| `HF_TOKEN` | `scripts/validate_and_download_model.py:475`; docs | **Not read by the Next.js app** — app uses `appconfig.apiKey` (`models/download/route.ts:237`) |

No `.env*` files referenced by code.

## 6. Feature inventory (README Roadmap)

| ID | Feature | Phase | Status | Evidence |
|---|---|---|---|---|
| F1.1 | Settings fields → controlled state | 1 | Partial — 3 controlled; API key, temperature, context window, max downloads, download behavior use `defaultValue` | `settings/page.tsx:109-138` vs `:148,154,159,164,171` |
| F1.2 | Save → `handleSave` | 1 | Done (code) `[UNVERIFIED runtime]` | `settings/page.tsx:60-72,193` |
| F1.3 | Persist provider/model/key securely | 1 | Missing — plaintext JSON in tracked file; GET echoes key | `lib/app-config.ts:31-62`, `appconfig/route.ts:7` |
| F1.4 | Dashboard uses `/api/analysis` | 1 | Partial — page calls GET; GET is a stub | `page.tsx:29`, `analysis/route.ts:4-12` |
| F1.5 | Loading/success/error states | 1 | Partial — present in review/settings/compare/models/execute state hooks | `review/page.tsx:35-37`, `compare/page.tsx:14-17`, `manage-models/page.tsx:45-48` |
| F1.6 | Validate SP input | 1 | Partial — non-empty only; 30k prompt cap in review | `execute/route.ts:26-31`, `compare/route.ts:15`, `review/route.ts:69` |
| F2.1 | SQL Server execution (`mssql`) | 2 | Partial — STATISTICS read from `recordsets`; mssql emits them as `info` messages → stats likely empty `[UNVERIFIED]` | `sp-executor.ts:221-253` (`:250`) |
| F2.2 | PostgreSQL execution (`pg`) | 2 | Partial — wraps input in `EXPLAIN (ANALYZE…)`; invalid for `CREATE`/`CALL` `[UNVERIFIED]` | `sp-executor.ts:255-278` (`:272`) |
| F2.3 | Plans + STATISTICS IO/TIME | 2 | Partial — no SQL Server showplan; PG text plan only | `sp-executor.ts:238-244,272` |
| F2.4 | Normalize CPU/elapsed/reads/scans | 2 | Partial — PG CPU is fabricated (`execMs*0.8`), single pseudo-table, LOB reads hardcoded 0 | `sp-executor.ts:290-292,326,328-332` |
| F2.5 | Connection testing | 2 | Missing | no route |
| F2.6 | Timeout/cancel/safe params | 2 | Missing — raw text concatenated into batch | `sp-executor.ts:238-246` |
| F2.7 | Persist results + audit | 2 | Partial — SQLite + txt logs (txt logs hold full SP) | `execute/route.ts:81-91`, `sp-executor.ts:96-131` |
| F2.x | Simulation mode | 2 | Mock — `Math.random()` metrics | `sp-executor.ts:138-215` |
| F3.1 | Review ↔ Transformers.js | 3 | Broken `[UNVERIFIED]` — prompt asks for `findingsTable/…`, validator requires `issues[]` | `analysisSP.md:58-100` (no `"issues"`), `review/route.ts:317-319` |
| F3.2 | Model loading/availability/status | 3 | Partial — pipeline cache, ONNX discovery; no status API | `review/route.ts:23,90-103`, `lib/installed-models.ts:64-112` |
| F3.3 | Configurable model/temperature/context | 3 | Partial — model selectable; temp 0, 700 tokens, `dtype:"q4"` hardcoded; config values unused | `review/route.ts:94-97,248-253` |
| F3.4 | Prompt templates (review/opt/compare/audit) | 3 | Partial — only review prompt wired; `explainStatistic.md` empty; compare prompt builder unused | `review/route.ts:30-50`, `ai-transformer.ts:64-106` |
| F3.5 | Keep SQL/creds in local boundary | 3 | Partial — inference is local CPU; no enforced policy; UI defaults say OpenAI | `review/route.ts:95-96`, `settings/page.tsx:18-19` |
| F3.6 | Inference timeout/fallback | 3 | Missing — only `maxDuration=300` | `review/route.ts:10` |
| F4.1 | SP review end-to-end | 4 | Broken (see F3.1); no persistence | `review/route.ts:267-274` |
| F4.2 | Compare via normalized telemetry | 4 | Partial — execute compare mode only; `/api/compare` is mock | `audit-analyzer.ts:154`, `ai-transformer.ts:175` |
| F4.3 | Recommendations by severity & category | 4 | Partial — severity only | `review/page.tsx:251` |
| F4.4 | Before/after metrics | 4 | Partial — execute compare (simulation data unless live) | `execute/route.ts:58-68` |
| F4.5 | Accept/reject/notes | 4 | Missing | — |
| F4.6 | Share with access control + expiry | 4 | Partial — token on every record, public, no expiry | `compare/route.ts:28`, `execute/route.ts:79`, `db/index.ts:41-50` |
| F5.1 | Validate metadata before download | 5 | Partial — HTTPS+host check (TS); preflight (Py) | `models/download/route.ts:71-75`, `validate_and_download_model.py:432` |
| F5.2 | Download progress | 5 | Missing — single blocking POST | `models/download/route.ts:232-238` |
| F5.3 | Cancel + retry | 5 | Missing | — |
| F5.4 | Prevent duplicate downloads | 5 | Missing — `modelAlreadyInstalled` defined, never called; dest is `rm`'d | `models/download/route.ts:200,270` |
| F5.5 | Checksum/integrity | 5 | Partial — Python SHA-256 only; TS validator checks file presence | `validate_and_download_model.py:89,200`, `lib/validate-model.ts:51-63` |
| F5.6 | Delete + disk usage | 5 | Partial — size shown; no delete | `models/refresh/route.ts:94-108` |
| F5.7 | Refresh installed status | 5 | Done (code); `installedAt` never written (download writes `downloadedAt`) | `refresh/route.ts:144`, `download/route.ts:246` |
| F6.1 | Login/logout UI | 6 | Missing — APIs only | no login page |
| F6.2 | Protect routes | 6 | Missing | no middleware/proxy |
| F6.3 | Server-side secret storage | 6 | Missing | `data/appconfig.json:10` |
| F6.4 | Redact creds/SQL from logs | 6 | Missing — full SP in txt logs; errors logged raw | `sp-executor.ts:105-106`, `execute/route.ts:95` |
| F6.5 | CSRF, rate limit, validation | 6 | Missing | — |
| F6.6 | TLS for SQL/model | 6 | Missing — `trustServerCertificate` default **true**; PG no `ssl` | `sp-executor.ts:235,263-269` |
| F7.1–7.4 | Unit/API/component/E2E tests | 7 | Missing — no test files, no `test` script; `vitest@4.1.11` only transitively via prisma | `npm ls vitest` |
| F7.5 | CI lint/type/build | 7 | Missing — no `.github/`. Today: `tsc` **pass**; `lint` **fail** (99 problems, 32 errors; 51 of them — 1 error, 50 warnings — in `.agents/`) | command output |
| F7.6 | Document runtime versions | 7 | Missing — guide says "compatible with installed Next.js" | `developer_guide.md:259-286` |

Unused modules (not in Roadmap): `lib/datadog-analyzer.ts`, `lib/model-store.ts` (OpenAI/Ollama fixtures), `lib/model-validation.ts`, `lib/model-path.ts`, `components/layout/Navbar.tsx` (links to nonexistent `/dashboard`).

## 7. Test and CI status

- Tests: none. CI: none. `tsc --noEmit`: exit 0. `npm run lint`: exit 1 — top src errors `no-explicit-any` (sp-executor, execute, auth, audit, share), `no-require-imports` (`sp-executor.ts:224,258`), `react-hooks/set-state-in-effect` (`manage-models/page.tsx:89`, `providers.tsx`). `eslint.config.mjs` does not ignore `.agents/**`.
- `npm run build` not run (would write `.next/`; ask first).

## 8. Docs-vs-code contradictions

| Doc claim | Code reality | Q |
|---|---|---|
| README: edit `app/page.tsx` (`README.md:23`) | `src/app/page.tsx` | Q11 |
| README: LLM layer = Python HF `transformers` (`README.md:34`) | Transformers.js in `/api/review` only; Python used only for download | Q3 |
| README store = "SQLite / Audit Logs" (`README.md:58`) + `prisma.config.ts` | raw better-sqlite3 at `../../sqllens_db`; Prisma unused | Q2 |
| README model requirements omit `.onnx` (`README.md:286-291`) | Python accepts `.onnx` (`validate_and_download_model.py:19-24`) | Q11 |
| README usage path `/Users/kamalsoft/dev/dbPro/sqlens` (`README.md:241`) | machine-local; remote is `kamalsoft/sqlens` (not `sqlLens`) | Q11 |
| README "Deploy on Vercel" (`README.md:140-144`) | local SQLite outside repo, local fs models, CPU inference | Q8 |
| `docs/api.md:3` `GET /api/models` | route is `/api/review/models`; 12 other routes undocumented | Q11 |
| `docs/configuration.md:13` | corrupted repeated text; claims `HF_TOKEN` is used — app uses `apiKey` | Q7 |
| `docs/configuration.md:14` "Do not execute submitted SQL" | `/api/execute` executes submitted SQL | Q4 |
| `docs/architecture.md:65-80` review response | matches route, but contradicts prompt schema | Q1 |
| `docs/troubleshooting.md` | duplicate of limitations (title "# Limitations") | Q11 |
| `docs/limitations.md:2` | stray ```` ````markdown ```` fence | Q11 |
| `docs/changelog.md` | 2 lines, no versions | Q11 |
| `AGENTS.md` "never commit `__pycache__`" | `scripts/__pycache__/*.pyc` tracked | Q10 |
| Settings UI defaults OpenAI/`gpt-4o-mini` (`settings/page.tsx:18-19`) | server defaults HF/Phi-3 (`app-config.ts:19-20`); Phi-3 repo is not ONNX | Q3 |

## 9. Inconsistency list → questions

| # | Inconsistency | Evidence | Q |
|---|---|---|---|
| I1 | Prompt output schema ≠ API validator/UI schema | `analysisSP.md:58-100`, `review/route.ts:306-361`, `review/page.tsx:8-22` | Q1 |
| I2 | Persistence: raw SQLite outside repo vs Prisma config/deps | `db/index.ts:7`, `prisma.config.ts`, `package.json` | Q2 |
| I3 | AI runtime: Transformers.js vs mock compare vs cloud defaults | `ai-transformer.ts:166-178`, `model-store.ts:14-24` | Q3 |
| I4 | Execute-SQL policy contradiction; simulation as random data | `configuration.md:14`, `sp-executor.ts:138` | Q4, Q5 |
| I5 | Auth is simulated; anonymous fallback on write routes | `auth/login/route.ts:11`, `execute/route.ts:33-50` | Q6 |
| I6 | HF token source (`apiKey` in tracked JSON vs `HF_TOKEN`) | `download/route.ts:237`, `appconfig.json:10` | Q7 |
| I7 | Deployment target (Vercel vs local) | `README.md:140` | Q8 |
| I8 | Test tooling absent; Storybook config w/o deps | `package.json`, `.storybook/main.js` | Q9 |
| I9 | Repo hygiene: untracked `a.sh`/`.storybook`/`audit_logs`, uncommitted `installed-models.ts` + lock diff, tracked `.pyc`, unused modules | `git status`, §6 | Q10 |
| I10 | README boilerplate + stale/corrupt docs | §8 | Q11 |
| I11 | Existing agent files: `AGENTS.md` token governance, empty `.claude/skills` (prisma sync target), archify skill | `AGENTS.md`, `prisma.config.ts:4` | GATE 2 (layout) |

## 10. Questions — Round 1

Q1. Which review output contract is canonical? → blocks F3.1/F4.1/F4.3. Options: a) prompt's rich schema (findings/performance/security/testing tables) and update validator+UI · b) route's `issues[]` schema and simplify the prompt · c) versioned both. Suggested: a (prompt already has `category`, satisfying F4.3).
Q2. Persistence direction? → blocks F2.7/F4.5/F4.6/F6.x. a) keep raw better-sqlite3, add versioned SQL migrations · b) adopt Prisma (schema + migrate; align CLI 8-rc/client 7) · c) keep SQLite and remove unused Prisma client. Also: keep DB at `../../sqllens_db` ("R008") or move to configurable path? Suggested: a + configurable path.
Q3. AI scope: a) local Transformers.js only (remove OpenAI/Ollama defaults) · b) local default + opt-in cloud provider · c) other. Suggested: a (DoD #2/#6 say local).
Q4. Simulation mode: a) keep, labeled, excluded from compare/persistence · b) keep as-is · c) remove. And which doc rule wins — "do not execute submitted SQL" or `/api/execute`? Suggested: a; execution allowed only behind auth + explicit opt-in.
Q5. Safe execution model (DoD #4): a) `EXEC <existing proc>` with typed parameters only · b) arbitrary batch inside a transaction that is always rolled back · c) both, a default. Suggested: c.
Q6. Auth model (DoD #1): a) single local admin, scrypt hash via `node:crypto` (no new dep) · b) multi-user with registration · c) external IdP. Suggested: a.
Q7. HF token: a) env `HF_TOKEN` server-side only, drop `apiKey` from JSON/GET · b) encrypted server-side store · c) keep. Suggested: a.
Q8. Deployment target: a) local/self-hosted only (remove Vercel section) · b) hosted multi-tenant. Suggested: a.
Q9. Test stack (new deps need approval): a) Vitest + Testing Library + Playwright, GitHub Actions CI · b) Node test runner only · c) other. Keep or drop `.storybook/`? Suggested: a; drop Storybook.
Q10. Hygiene: for `a.sh`, `.storybook/`, `audit_logs/` (contains SP text — add to `.gitignore`?), uncommitted `installed-models.ts` + `package-lock.json`, tracked `scripts/__pycache__`, unused modules (§6) — keep / ignore / remove each? Suggested: ignore `audit_logs/`, untrack `.pyc`, keep the `installed-models.ts` fix, ask before deleting anything else.

Queued for Round 2 (not asked yet): Q11 docs/README cleanup scope (I10) · Q12 `npm` as runtime dependency · Q13 whether `npm run build` may be run for verification · Q14 `.agents/` excluded from lint.
