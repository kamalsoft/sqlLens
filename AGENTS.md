<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository Agent Guidelines

### Context and Execution

- Read `docs/developer_guide.md` and `docs/ROADMAP.md` before architectural changes.
- Use targeted searches and diffs; do not scan `node_modules/`, `.next/`, model weights, or binary assets.
- Limit recursive search/edit cycles to three per task.
- Ask for confirmation before large refactors or broad file changes.
- Do not repeat unchanged file reads or redundant terminal commands.

### Code Changes

- Inspect the relevant installed Next.js documentation before modifying Next.js code.
- Keep changes within the requested scope.
- Preserve existing API contracts unless a breaking change is explicitly requested.
- Treat SQL input as untrusted text.
- Keep model, filesystem, and database operations server-side.
- Validate model-generated JSON before returning or rendering it.
- Do not execute SQL without explicit authorization and safety controls.

### Secrets and Generated Files

Never commit:

- Hugging Face tokens.
- `keys.md` or `.env*` files.
- Database credentials or connection strings.
- Downloaded model weights.
- `.next/`, `node_modules/`, `__pycache__/`, or generated build artifacts.

### Documentation

Update the relevant files when routes, prompts, configuration, scripts, or workflows change:

- `docs/developer_guide.md` — architecture and onboarding.
- `docs/architecture.md` — system boundaries and data flow.
- `docs/ROADMAP.md` — audited status and release planning.
- `README.md` — public setup and documentation links.

Do not mark a feature `[COMPLETED]` without runtime verification.

### Validation

Run only commands defined in `package.json`:

```bash
npm run
npm run build
```

For Python downloader changes:

```bash
python3 -m py_compile scripts/validate_and_download_model.py
```

Before completing a task:

```bash
git diff --check
git status --short
```
