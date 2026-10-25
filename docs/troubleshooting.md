# Troubleshooting

Condensed from [Developer Guide §11](developer_guide.md#11-troubleshooting). Limits of the reviewer are in [Limitations](limitations.md).

## Model is not listed

Check:

- `data/appconfig.json` and the expanded `downloadDirectory`.
- The model directory contains `config.json` and a compatible ONNX file under `onnx/`.
- `sqlens-model.json` contains the expected model ID.
- Failed temporary download directories are not counted as models.

Evidence: `src/app/api/review/models/route.ts:6-9`; `src/lib/installed-models.ts`.

## Hugging Face returns HTTP 401

The token is missing, expired, invalid, or lacks access to the repository.

- For the Python script, check that `HF_TOKEN` is set without printing it: `echo "${HF_TOKEN:+HF_TOKEN is set}"`.
- For the app, the token is the `apiKey` field in `data/appconfig.json` (`src/app/api/models/download/route.ts:236`). Check that the field is non-empty without printing its value. Planned: P1-03 switches the app to `HF_TOKEN`.

## Hugging Face returns HTTP 404

The repository ID or its casing is wrong, or the repository no longer exists.

## Safetensors or GGUF files were downloaded

The repository is not usable by the ONNX-based Transformers.js route. Remove the incomplete directory and choose a repository with ONNX weights (`onnx/*.onnx`). The Python script accepts `.onnx` among its weight extensions (`scripts/validate_and_download_model.py:19-25`).

## Review returns HTTP 502 "Unable to parse model response"

The model output was not valid JSON. The model may be too small, the output may be truncated, or the prompt may be too large. Inspect the `details` object in the response (`src/app/api/review/route.ts:276-289`), then reduce the input or use a larger instruction-tuned ONNX model. Planned: P3-01 changes the expected schema.

## Review returns HTTP 422

The model is installed but marked incompatible (`src/app/api/review/route.ts:213-220`). Choose an ONNX model.

## React reports "Objects are not valid as a React child"

`/api/review` returns a structured `result` object. Render its fields individually instead of rendering `{result}` directly.
