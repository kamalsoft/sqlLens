# Changelog

## Unreleased

- Added the test stack: Vitest and Testing Library for unit and component tests, Playwright for end-to-end tests, and the `test`, `test:e2e`, and `typecheck` scripts (`package.json:12-14`; `vitest.config.mts`; `playwright.config.ts`). Decision D-009.
- Excluded `.agents/**` (vendored agent skills) from ESLint (`eslint.config.mjs`).
- Added versioned SQLite migrations (`src/db/migrate.ts`, `src/db/migrations/001_baseline.sql`) and the `SQLLENS_DB_DIR` setting. Decisions D-002, D-020, D-022.
- Ignored Python bytecode, `audit_logs/`, and Playwright output in `.gitignore`; removed tracked `.pyc` files from the index. Decision D-010.
- Corrected README, API, configuration, troubleshooting, and limitations docs to match the code.
- Added the squad team workflow files (`.team/`, `docs/team/`).
- Added model validation and download documentation.
- Documented API, configuration, security, testing, deployment, and limitations.
