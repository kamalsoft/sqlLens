# Changelog

## Unreleased

- Execute page: after a successful single run, a "Refactor Stored Procedure" panel generates a refactored version and index, view and other recommendation scripts with a local model, each in its own section with a copy button. The run's verdict, hot tables and plan findings are sent to the model as instructions (`src/lib/refactor-evidence.ts`). For a procedure run by name, its text is read with the new read-only `POST /api/execute/definition`. A refactored batch can be put into the Optimized editor ("Use as Optimized"); nothing runs until Execute is pressed. The Refactor page and the panel share `src/components/refactor/RefactorResultView.tsx`.
- The grade rationale names the metric that set the grade (for example "Graded D by logical reads 14,139 (grade C needs under 5,000)").
- One colour system on every screen: all pages and `globals.css` take their colours from `src/lib/theme-tokens.ts`. The orange, blue and purple accents are now a single cyan accent, and status, grade and verdict colours use a colour-vision-safe palette with a symbol or letter beside the colour (`src/lib/status-tone.ts`; `tests/unit/theme-consistency.test.ts`).
- Added the test stack: Vitest and Testing Library for unit and component tests, Playwright for end-to-end tests, and the `test`, `test:e2e`, and `typecheck` scripts (`package.json:12-14`; `vitest.config.mts`; `playwright.config.ts`). Decision D-009.
- Excluded `.agents/**` (vendored agent skills) from ESLint (`eslint.config.mjs`).
- Added versioned SQLite migrations (`src/db/migrate.ts`, `src/db/migrations/001_baseline.sql`) and the `SQLLENS_DB_DIR` setting. Decisions D-002, D-020, D-022.
- Ignored Python bytecode, `audit_logs/`, and Playwright output in `.gitignore`; removed tracked `.pyc` files from the index. Decision D-010.
- Corrected README, API, configuration, troubleshooting, and limitations docs to match the code.
- Added the squad team workflow files (`.team/`, `docs/team/`).
- Added model validation and download documentation.
- Documented API, configuration, security, testing, deployment, and limitations.
