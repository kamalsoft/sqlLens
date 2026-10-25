---
name: sqllens-architecture
description: Use when you need the SQLLens module map, data flow, or where a feature lives (pages, API routes, lib modules, storage) before planning or editing any SQLLens code.
---
# SQLLens architecture (facts)

Last verified: `22d84fa` · Sources: `docs/team/discovery.md` §2–4, `src/**`

## Layers
- UI: App Router in `src/app/` (not `app/`). Root `layout.tsx` wraps `Providers` (Chakra) + `AppShell` (sidebar, `src/components/AppShell.tsx:6-12`).
- API: route handlers in `src/app/api/**/route.ts` (13 routes, table in discovery §3). No `src/proxy.ts` yet → nothing protected.
- Engine: `src/lib/sp-executor.ts` (simulation | mssql | pg) → `src/lib/audit-analyzer.ts` (grades, compare).
- AI: `src/app/api/review/route.ts` = only real inference (Transformers.js `pipeline("text-generation")`). `src/lib/ai-transformer.ts` = regex mock used by `/api/compare`.
- Models: discovery `src/lib/installed-models.ts`; download `src/app/api/models/download/route.ts` + `src/lib/huggingface-download.ts` + `src/lib/validate-model.ts`; catalog/refresh `src/app/api/models/refresh/route.ts`.
- Config: `data/appconfig.json` via `src/lib/app-config.ts` (server-only). Prompts: `data/prompts/`.
- Storage: SQLite `../../sqllens_db/sqllens.db` (`src/db/index.ts:7`) tables users, sessions, app_config (unused), audit_requests; text logs in `audit_logs/` (git-ignored).

## Flows
- Review: `/review` → GET `/api/review/models` → POST `/api/review` {modelId, sql} → prompt `analysisSP.md` → JSON validated → UI. Not persisted.
- Execute: `/execute` → POST `/api/execute` {mode, originalSP, optimizedSP?, connection} → `executeSP` → analyze/compare → `audit_requests` + txt log + share token.
- Compare: `/compare` → POST `/api/compare` → mock review → `audit_requests`.
- Share: `/share/[token]` → GET `/api/share/[token]` (public, no expiry).

## Approved direction (`.team/decisions.md`)
D-001 versioned review schema · D-002 SQLite + SQL migrations · D-003 local Transformers.js only · D-004/D-005 execution policy · D-006 single local admin · D-007 `HF_TOKEN` env · D-008 local deployment.

## Don't
- Don't assume Prisma: `prisma.config.ts` only configures skill sync; `@prisma/client` is unused.
- Don't touch unused modules (`datadog-analyzer.ts`, `model-store.ts`, `model-validation.ts`, `model-path.ts`, `layout/Navbar.tsx`) unless a task says so.
