# ai-models — history

Append-only learnings (date, task ID, fact, evidence path:line). Scribe promotes durable facts into skills.

- 2026-10-24: role created (D-011). Baseline `22d84fa`.

## 2026-10-24 P1-03 / P3-01 / P3-05
- HF token now only from `process.env.HF_TOKEN` in models/download route; removed dead helpers that took tokens.
- Review: `src/lib/review-schema.ts` (v1/v2 validators, errors prefixed with field path), `src/lib/review-prompt.ts` (selection/build, testable without Next route exports). Default schemaVersion v2; invalid -> 400.
- Refresh catalog trimmed to ONNX repos only (Qwen2.5-0.5B-Instruct-ONNX).
- Experiment: Qwen2.5-0.5B q4 with v2 prompt returns parseable JSON (in a code fence) but copies enum placeholders literally ("a|b|c") so v2 validation fails at findingsTable[0].category. Expect v2 failures from 0.5B; consider fallback to v1 or enum-repair/few-shot later.

## 2026-10-24 P6-03c / P3-02 / P3-03 / P3-04 / P3-06
- `src/lib/inference.ts`: one generation at a time; after a timeout the busy slot stays held until the underlying generation ends (no overlapping CPU work); default factory passes InterruptableStoppingCriteria and interrupts on timeout. dtype from ONNX file (q4 > q8 > fp32 > fp16). Context limit = min(config.contextWindow, config.json max_position_embeddings); needs >=64 new tokens of room else PromptTooLargeError (route 400).
- `downloadDirectory` config rule now requires a path under $HOME (backend), so route tests bypass it by mocking `readAppConfig` in tests/unit/review-route.test.ts.
- Prompts: templates hold a bare `{{STORED_PROCEDURE}}`; `buildPrompt` adds the `<stored_procedure>` tags (do not add tags in the template).
- Experiment (Qwen2.5-0.5B q4, temp 0.2, 700 tokens, dynamic-SQL sample): first rewrite (placeholder-free example) 0/7 valid (unterminated strings, severity "none", missing testingTable.test). After adding a "single line, \n escapes, all keys" rule and a quote-free example: 3/5 valid, failures = truncation at 700 tokens and a malformed array. Enum copying is gone. Small sample, not statistically meaningful.

## 2026-10-25 W1#6, P4-01, P4-02
- Download route: all rm calls go through safeRemove (path containment vs download root); unsafe modelId -> 400; cleanup errors logged, never returned.
- Shared helpers: extract-json, model-run (resolve + error mapping), review-telemetry, compare (schema + prompt, single-pass placeholder replace).
- Compare persists response {result, metrics, originalAuditId, optimizedAuditId}; elapsed_ms/logical_reads columns left null to avoid double-counting stats.
