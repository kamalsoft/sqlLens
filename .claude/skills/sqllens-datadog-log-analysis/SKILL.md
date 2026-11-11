---
name: sqllens-datadog-log-analysis
description: Use when parsing Datadog or raw log text for SQL errors, wiring that analysis into a route, or handling log content with SQL or personal data.
---
# Datadog and raw log analysis

Last verified: `b90cda9` · Sources: `src/lib/datadog-analyzer.ts`, `src/lib/redact.ts`, `src/lib/datadog/` (empty directory)

## Current state (read first)
- `parseDatadogLogs` and `parseRawLogText` exist in `src/lib/datadog-analyzer.ts`.
- **Nothing calls them.** No route under `src/app/api` and no page imports them. `src/lib/datadog/` is empty.
- Treat this as unwired code. Wiring it is a new feature: it needs a task ID, an approved decision, and Security review (log content can include SQL text and personal data).

## What the parser does
- `parseRawLogText(raw)`: one log per line. A line that is valid JSON becomes a `DatadogLog`; any other line becomes `{ message: line, timestamp: now }`.
- `parseDatadogLogs(logs)`: takes each log's `message`, falling back to `error.message`, then to `JSON.stringify(attributes)`. It matches the `SQL_ERROR_PATTERNS` list and produces `ParsedSqlError` items with `errorType`, `errorCode` (from `error.code` or `db.error_code`), a message truncated to 500 characters, and severity.
- Duplicates are dropped when the type and the first 50 characters of the message match.

## Rules
- Log input is **untrusted data**. Never execute, eval, or render it as HTML.
- Cap input size before parsing (line count and total bytes). The parser has no cap today. Add one at the route when wiring it.
- Run `redact()` (`src/lib/redact.ts`) on any text before it is stored, displayed, or logged. Logs can contain connection strings, tokens, and SQL.
- Don't send log content to an external service (for example, a Datadog API) from this app without an explicit approval. Outbound data needs its own decision.
- Keep the parser pure: no I/O, no DB access, no network. The route does the I/O.

## If you wire it
1. Add a decision entry in `.team/decisions.md` (only the user approves it) and get a task ID.
2. Add a route that calls `requireSession` first, validates the body with a type guard, applies the size cap, runs the parser, and returns only the analysis.
3. Add tests: JSON lines, a plain-text line, a duplicate, a message over 500 characters, and a log with no `message`.
4. Security review before merge.
5. Update the API docs (`sqllens-docs-sync`).

## Verify
- `npm test`, `npm run typecheck`, `npm run build`.

## Don't
- Don't describe this as a shipped feature in docs or the roadmap until a route and a page exist and are verified at runtime (AGENTS.md).
- Don't add a Datadog client or API key handling without Security sign-off (`sqllens-auth-sessions`, `sqllens-security-redaction`).
