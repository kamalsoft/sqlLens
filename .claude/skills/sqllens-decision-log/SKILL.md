---
name: sqllens-decision-log
description: Use when a SQLLens choice must be made (library, path, scope, priority, approach) or a user reply must be recorded in .team/decisions.md.
---
# Decision log

Last verified: `22d84fa` · Source: `.team/decisions.md`

## Format
```
### D-### <title>
Status: PROPOSED | APPROVED | REJECTED
Context (evidence): <path:line>
Options: A / B / C
Recommendation: <option> — 1–2 line reason (not decided)
Impact if delayed: <blocked task IDs>
User decision: _pending_
```

## Rules
- Agents only add PROPOSED entries; next free ID = highest existing + 1.
- Only a user reply changes Status; Scribe quotes the reply and dates it.
- Ambiguous reply → leave PROPOSED, ask a clarifying question.
- When APPROVED changes a fact, update the affected `sqllens-*` skill and `.team/now.md`.
- Blocked tasks in `docs/team/plan.md` list decision IDs; unblock only after APPROVED.
