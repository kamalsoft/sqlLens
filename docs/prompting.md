# Prompting

The SQL review prompt is stored at:

```text
data/prompts/analysisSP.md
```

The prompt requires one JSON object containing evidence-based findings, recommendations, limitations and index ideas. Review prompts (`analysisSP.md`, `analysisSP.v1.md`, `analysisSP-verylarge.md`, `review-with-telemetry.md`) ask for findings only and no rewritten procedure (RV-2); `refactor.md` is the only prompt that asks for a rewrite.

Prompts must instruct the model not to invent schema, indexes, execution plans, runtime behavior, or vulnerabilities. The API validates the generated structure before returning it.
