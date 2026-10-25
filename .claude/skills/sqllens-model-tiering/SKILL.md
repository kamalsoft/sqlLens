---
name: sqllens-model-tiering
description: Use when spawning a SQLLens subagent or picking a Claude model for delegated work — run eligible tasks on the economy tier (haiku) first until its quota/rate limit is reached or quality fails, then normalize back to the agent's standard model.
---
# Model tiering: economy first, then standard

Last verified: `7014a4d` · Source: `.claude/agents/*.md` frontmatter

No Claude model is free. On a Claude plan every model draws on the same
usage allowance; smaller models draw it down more slowly. "Economy tier"
below means the cheapest model, not a zero-cost one.

## 1. Identify the tiers
| Tier | Model | Where it comes from |
|---|---|---|
| Economy | `haiku` | `model: "haiku"` on the Agent call |
| Standard | the agent's own `model:` (`sonnet` or `opus`) | omit `model` on the Agent call |

Read the current standard model from `.claude/agents/<name>.md` before
delegating; do not hard-code it here.

## 2. Decide eligibility (economy first)
Economy-eligible — mechanical, easy to verify:
- `Explore` searches and file location
- `scribe` log/history/decision formatting
- `qa` running existing tests or lint and reporting output
- docs-sync diff drafts and read-only summaries

Never economy — always standard:
- `security` sign-offs and `lead` decisions/reviews
- auth, sessions, credentials, SQL execution, model downloads, filesystem writes
- multi-file code changes or anything that changes an API contract

When unsure, use standard.

## 3. Run until the economy quota is used up
Delegate eligible tasks with `model: "haiku"`. Treat any of these as
"economy quota complete" for the rest of the session:
- an error or result mentioning rate limit, `429`, overloaded, or usage limit
- the user says the plan usage is near/at its limit (they can check with `/usage`)
- the agent fails to start or returns no result

Treat these as "economy quality failed" for that task only:
- the binary acceptance criteria or tests fail
- output touches files outside the task's target paths
- the result is incomplete or contradicts the evidence

## 4. Normalize to the standard model
- Rerun the same task once on the standard model (omit `model`); keep the prompt unchanged.
- After a quota signal, send all later delegations in the session to standard; do not keep probing economy.
- After a quality failure, escalate that task only; other eligible tasks may still use economy.
- Max one retry per tier. If standard also fails, stop and report (AGENTS.md 3-attempt rule).
- If the standard model is also rate-limited, stop and tell the user; do not loop or wait in a retry cycle.

## 5. Record it
Add one line to `.team/log/<YYYY-MM-DD>.md`: task ID, agent, tier used,
and the reason for any fallback (quota or quality). No prompts or secrets.

## Guardrails
- Spawn subagents only when the user or the squad workflow asks (`CLAUDE.md`).
- Author ≠ reviewer still applies; a tier change never skips review.
- Do not change agents' `model:` frontmatter from this skill — that is a decision for `.team/decisions.md`.
