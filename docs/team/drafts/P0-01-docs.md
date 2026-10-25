# P0-01 — proposed doc changes — APPLIED 2026-10-24 (user: "1, 2, 3")

## docs/developer_guide.md §7 "Development Commands"

Replace:

````diff
-If a test script exists in `package.json`, run it with:
-
-```bash
-npm test
-```
+Run unit and component tests (Vitest; no network, database, or model weights):
+
+```bash
+npm test
+```
+
+Type-check without emitting:
+
+```bash
+npm run typecheck
+```
+
+Run end-to-end tests (Playwright; starts `npm run dev` automatically). Browsers are
+not installed by `npm install`; install them once with `npx playwright install chromium`:
+
+```bash
+npm run test:e2e
+```
````

## docs/developer_guide.md §10 "Testing Expectations"

Replace the first block:

````diff
 ```bash
 python3 -m py_compile scripts/validate_and_download_model.py
 npm run lint
+npm run typecheck
+npm test
 rm -rf .next
 npm run build
 ```
+
+Test layout:
+
+- `tests/unit/**/*.test.ts` — pure functions and server modules (Node environment).
+- `tests/components/**/*.test.tsx` — React components; start the file with `// @vitest-environment jsdom`.
+- `tests/e2e/**` — Playwright specs (excluded from `npm test`).
+- Config: `vitest.config.mts` (alias `@/` → `src/`), `playwright.config.ts`, setup `tests/setup.ts`.
+- Tests must not use the network, a real database, or downloaded model weights.
````

## docs/contributing.md

````diff
-3. Run the build before submitting changes.
+3. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before submitting changes.
+4. Add or update tests for every behavior change (see `docs/developer_guide.md` §10).
-4. Do not commit model files, tokens, or local configuration.
-5. Update documentation when behavior or configuration changes.
+5. Do not commit model files, tokens, or local configuration.
+6. Update documentation when behavior or configuration changes.
````
