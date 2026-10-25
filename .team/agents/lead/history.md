# lead — history

Append-only learnings (date, task ID, fact, evidence path:line). Scribe promotes durable facts into skills.

- 2026-10-24: role created (D-011). Baseline `22d84fa`.
- 2026-10-24 P0-01: vitest 5 needs @types/node>=22 (repo ^20) → vitest 4.1.11. npm nested overrides crashed (edgesOut) → pin vite directly. Always install with --ignore-scripts to avoid prisma skills sync. jsdom 30 needs Node ^22.22.2 → CI must use Node 22+.
- 2026-10-24 P0-03: Next build/dev import db module from parallel workers → migrations must take IMMEDIATE lock and re-check inside txn.
