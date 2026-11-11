# MEM-002 `prisma skills sync` writes into `.claude/skills`

- Kind: issue
- Status: workaround
- Date: 2026-10-24 · Commit: 22d84fa
- Area: package.json (`postinstall`), `.claude/skills/`
- Owner: lead
- Links: D-032 · D-014

## Symptom
Running `npm install` runs `prisma skills sync` as a postinstall hook. That writes Prisma skill files into `.claude/skills`, mixing them with the project's `sqllens-*` skills.

## Micro detail
- Files: `package.json` → `"postinstall": "prisma skills sync || exit 0"`
- Environment: any fresh `npm install`
- Repro: `npm install` in a clean checkout, then check `.claude/skills/` for new folders

## Macro detail
- Project skills are the team's routing layer (D-014). Unexpected folders there change which skills agents see.
- Cross-cutting for all contributors.

## Root cause
Verified (log entry for P0-01): the postinstall hook writes to the skills folder.

## Fix (workaround only)
Install with `npm install --ignore-scripts`. The `postinstall` script is still in `package.json`, so a plain `npm install` still triggers it.

## Verification
- P0-01 installed dependencies with `--ignore-scripts`; test and typecheck ran clean.

## Prevention
Open question for the user: remove the postinstall hook, or keep it and move the output elsewhere. Until decided, keep this record `workaround`.
