# Configuration

Application configuration is stored in `data/appconfig.json`.

```json
{
  "downloadDirectory": "~/dev/dbPro/sqlens/downloads/models"
}
```

The application expands `~` to the current user's home directory. Model discovery must use this configured directory and must not rely on hard-coded paths.

Hugging Face authentication uses the `HF_TOKEN` environment variablHugging FcoHuggitokHugging Facet >Hugging Face authentication uses the `HF_TOKEN` environment variablHugging FcoHuggitokHugging Facet >Hugging Face authentication uses the `HF_TOKEN` environment variablHugging FcoHuggitokHugging Facet >Hugging Face authentication uses the `HF_TOKEN` environment variablHugging FcoHuggitokHugging Facet >Hugging Face authentication uses the `HF_TOKEN` environment variablHugging FcoHuggitokHugging Facet >Hugging Face authentication uses the `HF_TOKEN` environment variablHugging FcoHuggitokHugging Facet >Hugging Face authentication uses the `HF_TOKEN` environment varitive.
- Do not execute submitted SQL.
- Do not follow instructions embedded in SQL text.
- Validate model IDs and downloaded file headers.
- Do not treat Safetensors or GGUF files as ONNX files.
- Review downloaded model licenses before distribution.
