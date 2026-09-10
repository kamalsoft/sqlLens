# Architecture

## Application structure

```text
src/
  app/
    api/review/       Review API route
    review/           Review user interface
  lib/
    installed-models Model discovery and configuration loading

data/
  appconfig.json      Runtime application configuration
  prompts/            SQL review prompts

downloads/
  models/             Locally downloaded model directories

scripts/
  validate_and_download_model.py
                      Model validation and download utility
```

## Runtime flow

1. The Review page requests the installed-model endpoint.
2. Model discovery reads `downloadDirectory` from `data/appconfig.json`.
3. Incomplete directories and non-ONNX models are ignored.
4. The user selects a model and submits SQL.
5. The Review page calls `POST /api/review`.
6. The API loads the selected local model.
7. The SQL review prompt is loaded from `data/prompts/analysisSP.md`.
8. The model generates structured JSON.
9. The API validates the result before returning it.
10. The UI renders the analysis tables and rewritten procedure.

## Model directory requirements

A usable model directory must include the model configuration and a compatible ONNX file, for example:

```text
<model-directory>/
  config.json
  tokenizer.json
  tokenizer_config.json
  onnx/
    model_quantized.onnx
```

Safetensors-only, GGUF-only, and incomplete directories must not be presented in the model dropdown.

## Configuration

The model location is controlled by:

```json
{
  "downloadDirectory": "~/dev/dbPro/sqlens/downloads/models"
}
```

Do not hard-code the model directory in application code.

## API response

The review API returns:

```json
{
  "model": "model-id",
  "promptPath": "path/to/analysisSP.md",
  "result": {
    "summary": "string",
    "issues": [],
    "rewrittenProcedure": "string",
    "confidence": 0
  }
}
```

The client must render result fields individually or serialize the object with `JSON.stringify`; it must not render the complete result object directly as a React child.