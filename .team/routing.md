# Routing and Review (D-012, APPROVED 2026-10-24)

## Routing
| Task type | Owner | Reviewer |
|---|---|---|
| Page, form, loading/error UI | frontend | backend (API contract) |
| Route handler, request validation, DB schema/migration | backend | lead |
| Auth, sessions, CSRF, rate limit, share expiry | backend | security |
| SQL execution, connections, timeouts, telemetry parsers | sql-engine | security (execution) + qa (parsers) |
| Review/compare inference, prompts, model-JSON validation | ai-models | lead |
| Model download, validation, deletion | ai-models | security (network/fs) |
| Tests, CI | qa | owner of the code under test |
| Docs, README, decisions, skills | scribe | lead |
| Cross-area / architecture | lead plans → area owners | user |

## Review rules
1. Author ≠ reviewer, always.
2. Security sign-off is mandatory for: auth/sessions, credentials/tokens, SQL execution, share links, outbound network (Hugging Face), filesystem writes outside `audit_logs/` and the models dir, logging of SQL or request bodies.
3. qa confirms the task's binary acceptance criteria plus `npm run lint`, `npx tsc --noEmit`, tests, and `npm run build` (when D-018 is approved).
4. Work starts only on `APPROVED: start <task ID>`. Agents never commit, push, or branch without an explicit user instruction.
5. A task blocked by a PROPOSED decision stays blocked; the agent asks, never chooses.
6. Subagents: only for independent, sizeable areas, max 3 in parallel.
