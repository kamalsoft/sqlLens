# Prompting

The SQL review prompt is stored at:

```text
data/prompts/analysisSP.md
```

The prompt requires one JSON object containing evidence-based findings, recommendations, limitations, and a rewritten procedure.

Prompts must instruct the model not to invent schema, indexes, execution plans, runtime behavior, or vulnerabilities. The API validates the generated structure before returning it.
