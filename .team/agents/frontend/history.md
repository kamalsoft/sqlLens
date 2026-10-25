# frontend — history

Append-only learnings (date, task ID, fact, evidence path:line). Scribe promotes durable facts into skills.

- 2026-10-24: role created (D-011). Baseline `22d84fa`.

## 2026-10-24 P6-04 / P1-01 / P1-07
- `src/components/api-client.ts`: `useApi()` hook (fetch JSON, 401 -> `router.replace('/login?next=<pathname>')`, returns `{ok,status,data,error,field}`) and `sanitizeNext()`. All pages use it; tests mock `next/navigation` with a STABLE router object (an unstable one retriggers effects via useApi deps).
- `@testing-library/user-event` is not installed; `tests/components/user.ts` is a fireEvent shim. Number inputs: clearing yields 0 (Number("")), so tests use fireEvent.change.
- Providers no longer gate on `mounted` (react-hooks/set-state-in-effect); check hydration in the browser.
- zsh: `echo =====` errors in Bash tool; avoid.
- Did not run `npm run build` because the user's `next dev` shares `.next`.
