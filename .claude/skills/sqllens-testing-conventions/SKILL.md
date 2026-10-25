---
name: sqllens-testing-conventions
description: Use when writing or running SQLLens tests or CI (unit, API route, component, end-to-end) or deciding what a task's "tests required" means.
---
# Testing conventions

Last verified: `22d84fa` + P0-01 working tree (uncommitted) · Sources: `package.json`, `npm run lint`/`tsc` output, `.team/decisions.md` D-009/D-018/D-019

## Current state (after P0-01)
- Installed (exact, `--ignore-scripts`): vitest 4.1.11, vite 8.3.4, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/jest-dom 7.0.1, jsdom 30.1.2, @playwright/test 1.64.0 (D-032).
- Scripts: `npm test` (vitest run) · `npm run typecheck` (tsc --noEmit) · `npm run test:e2e` (playwright, `--pass-with-no-tests`).
- Config: `vitest.config.mts` (alias `@/`→`src/`, include `tests/**/*.test.{ts,tsx}`, env node), setup `tests/setup.ts` (jest-dom matchers + RTL cleanup), `playwright.config.ts` (testDir `tests/e2e`, webServer `npm run dev`).
- Layout: `tests/unit/` (node), `tests/components/` (first line `// @vitest-environment jsdom`), `tests/e2e/`.
- Gotchas: Playwright browsers are not installed (`npx playwright install chromium` = network, ask first). Modules importing `server-only` (e.g. `src/lib/app-config.ts:1`) need a test alias stub before they can be imported. `src/lib/sp-executor.ts:69-72` creates `audit_logs/` at import time. jsdom 30 needs Node ^22.22.2.
- No `.github/` CI yet (P7-07). `npm run lint` baseline after P0-02: 48 problems / 31 errors, all in `src/` + `postcss.config.mjs` (P7-06).

## Rules
- Tests never hit the network, a real DB, or model weights. Use a temp SQLite file per test, a mocked `pipeline`, fixture telemetry text.
- Each task's acceptance criteria must map to at least one automated test or a recorded manual check.
- Report command, exit code, and filtered failures only.

## Don't
- Don't add test deps or scripts without an APPROVED decision; install with `--ignore-scripts`.
- Don't mark a roadmap item `[COMPLETED]` without runtime verification (AGENTS.md).
