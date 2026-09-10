# Model Management

## Supported model format

SQLens currently expects models compatible with the local Transformers.js ONNX runtime.

Preferred repository characteristics:

- Exact Hugging Face model ID
- ONNX model files
- Tokenizer files
- Model configuration
- Compatible generation configuration

## Recommended workflow

Search Hugging Face:

```bash
curl -fsSL \
  -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/api/models?author=onnx-community&search=Qwen&limit=100" \
  | jq -r '.[].id'
```

Inspect a candidate repository:

```bash
curl -fsSL \
  -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/api/models/OWNER/MODEL" \
  | jq -r '.siblings[].rfilename'
```

Confirm ONNX files:

```bash
curl -fsSL \
  -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/api/models/OWNER/MODEL" \
  | jq -r '.siblings[].rfilename' \
  | grep '^onnx/'
```

Download and validate:

```bash
python3 scripts/validate_and_download_model.py \
  OWNER/MODEL
```

Replace `OWNER/MODEL` with the exact repository ID. Do not include angle brackets.

## Cleanup

Remove incomplete or incompatible model directories:

```bash
rm -rf downloads/models/<incomplete-model-directory>
```

Do not rename Safetensors or GGUF files to ONNX filenames. They are different formats and are not interchangeable.