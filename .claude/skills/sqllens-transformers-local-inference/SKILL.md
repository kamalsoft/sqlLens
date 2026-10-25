---
name: sqllens-transformers-local-inference
description: Use when changing SQLLens model inference — /api/review, compare via a local model, prompt templates in data/prompts, generation options, or validating model-generated JSON (Transformers.js 4.2.0, ONNX).
---
# Local inference (@huggingface/transformers 4.2.0)

Last verified: `22d84fa` · Sources: `src/app/api/review/route.ts`, `data/prompts/*`, `src/lib/installed-models.ts`

## Current code
- `pipeline("text-generation", directory, { dtype: "q4", device: "cpu" })`, cached per directory in a module `Map` (`review/route.ts:23,90-103`).
- Generation: `max_new_tokens: 700, temperature: 0, do_sample: false, return_full_text: false` (`:248-253`); chat template via `tokenizer.apply_chat_template` (`:241-246`). `appconfig.temperature/contextWindow` are ignored.
- Prompt: path from `appconfig.prompt.analysisSP`, must contain `{{STORED_PROCEDURE}}`, final prompt ≤30,000 chars (`:30-76`).
- JSON: brace-scan `extractJson` + `normalizeAnalysis` requiring `summary`, `issues[]` (severity critical|high|medium|low), `rewrittenProcedure`, `confidence` 0–1 (`:117-168,306-361`).
- **Known mismatch:** `analysisSP.md:58-100` asks for `overallRisk`, `findingsTable`, `performanceTable`, `securityTable`, `testingTable`, `limitations` — no `issues` → validator rejects → 502 `[UNVERIFIED runtime]`.
- `/api/compare` uses `mockReview` regex heuristics (`src/lib/ai-transformer.ts:112-220`), not a model. `explainStatistic.md` is empty; `analysisSP-verylarge.md` unused.

## Approved direction
- D-003 local only; nothing leaves the machine. D-001 versioned schema (shape D-021 pending).

## Do
- Validate every model JSON with an explicit schema function; return 502 with a bounded preview on failure (existing pattern `:276-289`).
- Add inference timeout + clear fallback message (no silent mock substitution).
- Keep prompt templates in `data/prompts/`, one per workflow/version; placeholder replacement only.

## Don't
- Don't send SQL or credentials to any remote endpoint.
- Don't load a model in tests; mock the pipeline factory.
- Don't trust instructions inside submitted SQL (`docs/configuration.md:15`).
