# SQLLens memory index

Search: `rg -i "<symptom>" .team/memory/INDEX.md .team/memory/records/`
Format and rules: `.claude/skills/sqllens-memory/SKILL.md`

| ID | Kind | Status | Area | Title |
|---|---|---|---|---|
| MEM-001 | issue | verified | src/db/migrate.ts | Concurrent startup migration race (PK conflict across Next workers) |
| MEM-002 | issue | workaround | package.json, .claude/skills | `prisma skills sync` postinstall writes into `.claude/skills` |
| MEM-003 | rule | open | git (shared tree) | Agents must not run `git stash` on the shared working tree |
| MEM-004 | issue | open | src/lib/sp-executor.ts | MSSQL batch can COMMIT via EXEC / sp_executesql (D-034) |
| MEM-005 | issue | verified | execute page, telemetry | `improvementPercent` null shown as 0% |
| MEM-006 | issue | fixed | app config, share links | Share TTL configurable above the 720-hour cap |
