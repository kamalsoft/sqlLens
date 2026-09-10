# API Reference

## `GET /api/models`

Returns installed, compatible ONNX models.

## `POST /api/review`

Request:

```json
{
  "modelId": "owner/model",
  "sql": "CREATE PROCEDURE dbo.Test AS SELECT 1;"
}
```

The response contains the selected model, prompt path, and structured analysis.

Common status codes:

- `200` — analysis completed
- `400` — missing or invalid request fields
- `404` — model is not installed
- `422` — model is incompatible
- `502` — model output could not be parsed
- `500` — unexpected server error
