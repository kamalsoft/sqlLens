---
name: sqllens-docs-sync
description: Use after any SQLLens change to routes, prompts, configuration, scripts, or workflows to decide which docs/*.md and README sections must be updated, and to draft those diffs.
---
# Docs sync

Last verified: `22d84fa` · Sources: `AGENTS.md` "Documentation Ownership", discovery §8

## Ownership (AGENTS.md)
`docs/developer_guide.md` onboarding/workflows · `docs/architecture.md` boundaries/data flow · `docs/ROADMAP.md` audited status · `README.md` setup + links · `CLAUDE.md` pointer only.

## Change → doc map
| Change | Update |
|---|---|
| Route added/changed | `docs/api.md`, `docs/architecture.md` |
| appconfig/env var | `docs/configuration.md`, `docs/developer_guide.md` setup |
| Prompt file/schema | `docs/prompting.md`, `docs/api.md` |
| Model download/validation | `docs/model-management.md`, README "Download and Validate" |
| Auth/security | `docs/developer_guide.md` §13, `docs/architecture.md` |
| Test/CI | `docs/contributing.md`, `docs/developer_guide.md` §10 |
| Any shipped item | `docs/changelog.md`; `docs/ROADMAP.md` status only with runtime evidence |

## Known doc defects (D-016)
`docs/api.md:3` wrong route · `docs/configuration.md:13` corrupted + wrong token source · `:14` contradicts `/api/execute` · `docs/troubleshooting.md` duplicates limitations · `docs/limitations.md:2` stray fence · README `app/page.tsx` (`:23`), Vercel (`:140-144`), Python transformers claim (`:34`), `.onnx` missing (`:286-291`).

## Rules
- Scribe drafts a diff; applies only after user approval. Owners never mark `[COMPLETED]` without runtime evidence.
- Cite path:line for every behavioral claim.
