# MEM-003 Agents must not run `git stash` on the shared tree

- Kind: rule
- Status: open
- Date: 2026-10-25 · Commit: b90cda9 (working tree had uncommitted changes)
- Area: git, all agents working in parallel
- Owner: lead
- Links: —

## Symptom
A subagent ran `git stash` and `git stash pop` in the shared working tree to test a baseline. It restored cleanly this time, but other agents' uncommitted edits were in the same tree during that window.

## Micro detail
- Command: `git stash` / `git stash pop` run by an agent during parallel work
- Environment: one working tree shared by several agents

## Macro detail
- Any agent can overwrite or misplace another agent's uncommitted work.
- Cross-cutting: affects every parallel task.

## Root cause
Verified (log, 2026-10-25): stash was used to get a clean baseline inside a shared tree.

## Fix
Rule: agents do not stash in the shared tree. To test a baseline, use `git worktree add <scratchpad-path> HEAD` and run tests there.

## Verification
Not yet enforced anywhere. This is a rule, so status stays `open` until it is written into agent instructions (`.claude/agents/`) or CLAUDE.md. That change needs the user's approval.

## Prevention
Add the rule to the agent definitions once approved.
