<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository Agent Guidelines

### Token Governance

- Maximum context target: 32,000 tokens.
- Maximum response target: 2,048 tokens.
- Maximum recursive search/edit cycles: 3.
- Read no more than 5 targeted workspace files per turn unless explicitly required.
- Exclude `node_modules/`, `.next/`, `.git/`, model weights, binaries, and generated artifacts.
- Filter terminal output to relevant errors and changed-file summaries.
- Do not repeat unchanged file reads, searches, or status checks.
- Ask for confirmation before broad refactors or changes affecting more than 10 files.

These are operating constraints for agents and tooling, not application-runtime guarantees.

### Context and Prompt Optimization

Before complex tasks:

1. Read only the relevant sections of `docs/developer_guide.md` and `docs/ROADMAP.md`.
2. Identify the target files, entry points, constraints, and verification commands.
3. Normalize the task into:
   - Task
   - Target paths
   - Constraints
   - Expected result
   - Verification steps
4. Prefer targeted `rg`, `find`, AST queries, and diffs over full repository reads.
5. Reuse stable repository documentation as context and append dynamic task details afterward.

Do not add provider-specific cache headers or API configurations unless the repository integrates that provider.

### Required Development Rules

- Inspect the relevant installed Next.js documentation in `node_modules/next/dist/docs/` before modifying Next.js code.
- Keep changes within the requested scope.
- Preserve existing API contracts unless a breaking change is explicitly requested.
- Keep filesystem, model, database, and secret-handling operations server-side.
- Treat SQL input as untrusted text.
- Validate model-generated JSON before returning or rendering it.
- Do not execute SQL without explicit authorization and safety controls.
- Update affected documentation when routes, prompts, configuration, scripts, or workflows change.
- Do not mark roadmap features `[COMPLETED]` without runtime verification.

### Do and Don't

| Area | Do | Don't |
|---|---|---|
| Context | Read targeted files and line ranges | Load the entire repository or dependency tree |
| Code changes | Make focused, reversible edits | Perform speculative refactors |
| Tooling | Run relevant, repository-defined checks | Repeat identical commands unnecessarily |
| Errors | Report concise diagnostics and likely causes | Retry indefinitely |
| Security | Keep tokens, SQL, and credentials protected | Log or commit secrets |
| Models | Validate IDs, metadata, structure, and ONNX compatibility | Rename GGUF or Safetensors files as ONNX |
| Documentation | Keep guides and roadmap statuses evidence-based | Document unverified routes or behavior |
| Git | Review diffs before staging or committing | Commit generated files or model weights |

### Secrets and Generated Files

Never commit:

- Hugging Face tokens.
- `keys.md` or `.env*` files.
- Database credentials or connection strings.
- Downloaded model weights.
- `.next/`, `node_modules/`, `__pycache__/`, or build artifacts.
- Local logs, temporary downloads, or validation caches.

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

If validation fails after three focused attempts, stop and report the failure instead of continuing an unbounded retry loop.

### Documentation Ownership

- `docs/developer_guide.md` — architecture, onboarding, and development workflows.
- `docs/architecture.md` — boundaries and data flow.
- `docs/ROADMAP.md` — audited status and release planning.
- `README.md` — public setup and documentation links.
- `CLAUDE.md` — delegates to this file and should not duplicate these rules.
