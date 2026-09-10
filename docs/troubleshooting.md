# Troubleshooting

## Model is not listed

Check `data/appconfig.json`, the configured directory, and that the model contains a compatible `onnx/` file.

## HTTP 401

The Hugging Face token is missing, expired, invalid, or lacks access.

## HTTP 404

The repository ID or casing is incorrect.

###########################################################################################################################################################################################################################################################the###########################################################################################################################################################################################################################################################the#################################################################################################################################################################################tations.md <<'EOF'
# Limitations

Analysis quality depends on the selected local model. The reviewer cannot reliably infer execution plans, indexes, schema metadata, data volume, or runtime behavior from procedure text alone.

Recommendations requiring runtime evidence should be verified with execution plans, `STATISTICS IO`, `STATISTICS TIME`, tests, and database-specific security review.
