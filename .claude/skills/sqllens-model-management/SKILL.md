---
name: sqllens-model-management
description: Use when changing SQLLens model discovery, download, validation, checksum, progress, cancellation, deletion, disk usage, or the Python validator script.
---
# Model management

Last verified: `22d84fa` · Sources: `src/app/api/models/**`, `src/lib/{installed-models,huggingface-download,validate-model}.ts`, `scripts/validate_and_download_model.py`

## Layout
- Root dir = `appconfig.downloadDirectory` (`data/appconfig.json:4` → `~/dev/dbPro/sqlens/downloads/models`, git-ignored). Python script ignores config and always writes `<repo>/downloads/models` (`validate_and_download_model.py:17`).
- Model dir name `owner_repo`; metadata `sqlens-model.json` keys `id, name, sourceUrl, architecture, validated` (python) / `id, name, sourceUrl, downloadedAt` (TS, `download/route.ts:240-252`).
- Usable for review = `config.json` + `onnx/{model,model_quantized,model_q4}.onnx` (`installed-models.ts:21-25,86-90`).

## Download route (`POST /api/models/download` {modelId, sourceUrl, name?})
- Only `https://huggingface.co/...` (`:71-75`); token = `appconfig.apiKey` (`:237`) → must become env `HF_TOKEN` (D-007).
- Downloads to `<dest>.download-<ts>`, validates (`validate-model.ts`: config + `onnx/*.onnx`), then `rm` dest + `rename` (`:229-272`).
- Missing: progress, cancel, retry, duplicate guard (`modelAlreadyInstalled` at `:200` never called), checksum verification (Python only: `:89,200`), delete endpoint.

## Refresh (`GET /api/models/refresh`)
- Hardcoded catalog (`refresh/route.ts:21-70`) merged with installed dirs; size via recursive stat; `lastUsed` reads `installedAt` which is never written.

## Commands
`python3 -m py_compile scripts/validate_and_download_model.py` · `HF_TOKEN=… python3 scripts/validate_and_download_model.py owner/model` (network — needs user approval).

## Don't
- Don't download or delete models without explicit user approval for that run.
- Don't rename GGUF/Safetensors as ONNX; Safetensors-only repos are not runnable here.
- Don't commit anything under `downloads/models/`.
