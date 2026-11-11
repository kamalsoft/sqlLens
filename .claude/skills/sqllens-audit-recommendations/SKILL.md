---
name: sqllens-audit-recommendations
description: Use when changing audit records, grades, metric comparisons, recommendation feedback, share links, or the /api/audit and /api/share routes.
---
# Audit records, analysis, recommendations, and sharing

Last verified: `b90cda9` · Sources: `src/db/audit-repo.ts`, `src/lib/audit-analyzer.ts`, `src/lib/index-recommendations.ts`, `src/app/api/audit/**`, `src/app/api/share/[token]/route.ts`, migrations `003`, `004`, `005`, `.team/decisions.md` (D-025)

## Records
- `audit_requests` holds every run. `AuditType` is `EXECUTE | EXECUTE_COMPARE | COMPARE | REVIEW | REFACTOR`.
- `insertAudit` returns `{ id, recordNumber }`. `record_number` (migration 003) is a per-table sequence used in the UI.
- `getAudit(id, sessionId)` and `listAudits(sessionId, limit = 100)` are scoped by session. Keep that scope. A user must never read another session's audit.
- `auditStats(sessionId)` powers the overview. Keep it session-scoped too.

## Analysis
- `analyzeExecution(result)` returns `AuditAnalysis` with a `Grade` of `A`–`F`.
- `compareExecutions(original, optimized)` returns a `MetricComparison` for `logicalReads`, `physicalReads`, `scanCount`, `cpu`, and `elapsed`, each as a `MetricDelta`.
- Inputs come from parsed telemetry (`sqllens-telemetry-parsing`). Analysis must not invent numbers. Missing metrics are "not captured", as the UI already shows (`NOT_CAPTURED` in `src/components/audit`).

## Recommendation feedback
- Table `recommendation_feedback` (migration 004): one row per `(audit_id, rec_key)`, `status` is `accepted | rejected | pending`, optional `note`, `user_id`.
- `upsertFeedback(auditId, userId, items)` writes the batch. Use it for PATCH `/api/audit/[id]/recommendations`. Validate every item (key length, status enum, note length) before writing.
- Feedback is for learning and reporting. It must not change the audit's stored analysis.

## Share links
- `createShare(id, ttlHours)`: 32 random bytes, base64url. Expiry = now + `ttlHours`. `ttlHours` comes from the request (1–720 hours, validated by the route) or from `shareTtlHours` in app config.
- `revokeShare(id)` sets `share_revoked = 1`. A revoked link is `not_found`, the same as an unknown token. Don't reveal which case it is.
- `lookupShare(token)` returns `ok`, `expired`, or `not_found`. A NULL expiry (legacy token) is treated as **expired** (migration 005).
- Per D-025 B, `GET /api/share/[token]` requires a session as well as the token. Keep it.
- Share responses return only the stored result. Never return the raw DB row.

## Verify
- Unit tests: `analyzeExecution` grades for a fixed input; `compareExecutions` deltas including a zero and a missing metric; `lookupShare` for `ok`, `expired`, `revoked`, unknown token, and NULL expiry.
- Route tests: another user's audit ID → 404; share PATCH/POST with `ttlHours` 0, 721, and `"abc"` → 400 with `field: "ttlHours"`.
- `npm test`, `npm run typecheck`, `npm run build`.

## Don't
- Don't make share links public without login (D-025).
- Don't widen `listAudits` beyond the session.
- Don't store SQL text in logs. Full SQL is kept only in the audit record, as D-028 decided.
- Don't write grade or metric logic in a route. Keep it in `audit-analyzer.ts`.
