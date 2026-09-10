# SQLens Developer Guide

## 1. Overview

SQLens is a Next.js application that reviews SQL Server stored procedures using locally downloaded, Transformers.js-compatible ONNX language models.

The application:

1. Reads model configuration from `data/appconfig.json`.
2. Discovers valid models under the configured `downloadDirectory`.
3. Lists available models in the Review page.
4. Loads the SQL review prompt from `data/prompts/analysisSP.md`.
5. Generates structured JSON through `POST /api/review`.
6. Validates the model response.
7. Renders findings, recommendations, limitations, and rewritten T-SQL.

SQL is analyzed as text only. SQLens does not execute submitted procedures.

---

## 2. Repository Layout

```text
sqlens/
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs
├── prisma.config.ts
├── skills-lock.json
├── data/
│   ├── appconfig.json
│   └── prompts/
│       ├── analysisSP.md
│       ├── analysisSP-verylarge.md
│       └── explainStatistic.md
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── configuration.md
│   ├── contributing.md
│   ├── deployment.md
│   ├── developer_guide.md
│   ├── limitations.md
│   ├── model-management.md
│   ├── prompting.md
│   ├── security.md
│   ├── testing.md
│   └── troubleshooting.md
├── scripts/
│   └── validate_and_download_model.py
└── src/
    ├── app/
    │   ├── api/
    │   │   ├── analysis/route.ts
    │   │   ├── appconfig/route.ts
    │   │   ├── audit/route.ts
    │   │   ├── auth/login/route.ts
    │   │   ├── auth/logout/route.ts
    │   │   ├── auth/me/route.ts
    │   │   ├── compare/route.ts
    │   │   ├── execute/route.ts
    │   │   ├── models/download/route.ts
    │   │   ├── models/refresh/route.ts
    │   │   ├── review/models/route.ts
    │   │   ├── review/route.ts
    │   │   └── share/[token]/route.ts
    │   ├── compare/page.tsx
    │   ├── execute/page.tsx
    │   ├── manage-models/page.tsx
    │   ├── review/page.tsx
    │   ├── settings/page.tsx
    │   ├── share/[token]/page.tsx
    │   ├── globals.css
    │   ├── layout.tsx
    │   ├── page.tsx
    │   └── providers.tsx
    ├── components/
    │   ├── AppShell.tsx
    │   ├── layout/Navbar.tsx
    │   └── review/ReviewPanel.tsx
    ├── db/index.ts
    └── lib/
        ├── ai-transformer.ts
        ├── app-config.ts
        ├── audit-analyzer.ts
        ├── datadog-analyzer.ts
        ├── huggingface-download.ts
        ├── installed-models.ts
        ├── model-path.ts
        ├── model-store.ts
        ├── model-validation.ts
        ├── sp-executor.ts
        └── validate-model.ts
```

### Generated and local directories

The following directories are local or generated and should not be committed:

- `.next/` — Next.js build output.
- `node_modules/` — installed npm dependencies.
- `downloads/models/` — downloaded model files.
- Python virtual-environment directories such as `.venv/`.
- Local secret files such as `keys.md` and `.env.local`.

---

## 3. Directory and File Responsibilities

### Root files

| File | Responsibility |
|---|---|
| `README.md` | Project introduction, quick-start instructions, and documentation index. |
| `package.json` | npm scripts, runtime dependencies, and development dependencies. |
| `package-lock.json` | Exact npm dependency resolution. |
| `next.config.ts` | Next.js configuration and build/runtime options. |
| `tsconfig.json` | TypeScript compiler configuration. |
| `eslint.config.mjs` | ESLint rules and source-file linting configuration. |
| `postcss.config.mjs` | PostCSS processing configuration. |
| `.gitignore` | Files and directories excluded from version control. |
| `AGENTS.md` | Repository-specific instructions for coding agents. |
| `CLAUDE.md` | Reference to the repository agent instructions. |

### `data/`

Runtime data that is read by the application but is not TypeScript source code.

#### `data/appconfig.json`

Defines application configuration.

```json
{
  "downloadDirectory": "~/dev/dbPro/sqlens/downloads/models"
}
```

The model-discovery code must read this value at runtime. Do not hard-code the model directory elsewhere.

#### `data/prompts/analysisSP.md`

Contains the SQL Server review prompt. The prompt defines:

- Review categories.
- Evidence requirements.
- JSON response shape.
- Severity values.
- Rewrite behavior.
- Limitations and confidence requirements.

Prompt changes can affect model output and should be reviewed like source-code changes.

### `docs/`

Project documentation. Documentation files should describe behavior that exists in the repository and must be updated when public workflows or configuration change.

### `scripts/`

Developer and operational scripts.

#### `scripts/validate_and_download_model.py`

Validates and downloads Hugging Face models. It is responsible for:

- Validating the exact `owner/model` identifier.
- Reading Hugging Face repository metadata.
- Checking repository file headers.
- Downloading repository files.
- Validating downloaded files and directory structure.
- Verifying checksums.
- Preserving failed downloads for diagnosis.

The script must only be used with repositories containing compatible ONNX assets. Safetensors-only and GGUF-only repositories are not interchangeable with ONNX models.

### `src/app/`

Next.js App Router source code.

#### `src/app/layout.tsx`

Root application layout. It defines the document shell and shared page metadata.

#### `src/app/page.tsx`

Application entry page. It provides the initial route and navigation into the review workflow.

#### `src/app/globals.css`

Global styling applied across the application.

#### `src/app/review/page.tsx`

Client-side stored-procedure review interface. It:

- Loads available models.
- Maintains selected model and SQL state.
- Submits review requests.
- Handles loading and error states.
- Renders structured analysis results.
- Displays findings and rewritten procedures.

The page must render result fields individually. It must not render the complete result object directly as a React child.

#### `src/app/api/review/route.ts`

Node.js API route for model-backed SQL review.

Responsibilities include:

- Parsing and validating the request body.
- Finding the requested installed model.
- Loading the configured prompt.
- Applying the prompt to submitted SQL.
- Calling the local model pipeline.
- Extracting and validating JSON output.
- Returning structured success and error responses.

The route is configured for the Node.js runtime because local filesystem and model operations are required.

#### `src/lib/installed-models.ts`

Model discovery boundary. It:

- Reads `data/appconfig.json`.
- Expands the configured home-directory path.
- Scans the configured model directory.
- Ignores incomplete directories.
- Requires model configuration and compatible ONNX files.
- Reads installed model metadata.
- Returns models for the API and Review page.

Model discovery must not depend on a hard-coded absolute path.

### `downloads/models/`

Local model storage. Each usable model must contain the files required by the local ONNX runtime, commonly including:

```text
<model-directory>/
├── config.json
├── tokenizer.json
├── tokenizer_config.json
└── onnx/
    └── model_quantized.onnx
```

The exact ONNX filename depends on the downloaded repository and runtime configuration. A directory containing only `.safetensors` or `.gguf` files is not a usable ONNX model.

---

## 4. Prerequisites

Install the following tools:

- Node.js compatible with the version required by the installed Next.js release.
- npm.
- Python 3.
- `jq`.
- Git.
- A Hugging Face account when the selected repository requires authentication.

Optional:

- A Python virtual environment for script dependencies.
- Hugging Face CLI tools.

Check installations:

```bash
node --version
npm --version
python3 --version
jq --version
git --version
```

---

## 5. Local Setup

Clone and enter the repository:

```bash
git clone <repository-url>
cd sqlens
```

Install JavaScript dependencies:

```bash
npm install
```

Create or verify `data/appconfig.json`:

```json
{
  "downloadDirectory": "~/dev/dbPro/sqlens/downloads/models"
}
```

Do not commit tokens. For authenticated Hugging Face access, set the token only in the shell:

```bash
read -s "HF_TOKEN?Hugging Face token: "
export HF_TOKEN
echo
```

Verify authentication:

```bash
curl -fsSL \
  -H "Authorization: Bearer $HF_TOKEN" \
  https://huggingface.co/api/whoami-v2 | jq
```

---

## 6. Model Validation and Download

Search available ONNX repositories:

```bash
curl -fsSL \
  -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/api/models?author=onnx-community&search=Qwen&limit=100" \
  | jq -r '.[].id'
```

Inspect an exact repository:

```bash
curl -fsSL \
  -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/api/models/OWNER/MODEL" \
  | jq -r '.siblings[].rfilename'
```

Check for ONNX files:

```bash
curl -fsSL \
  -H "Authorization: Bearer $HF_TOKEN" \
  "https://huggingface.co/api/models/OWNER/MODEL" \
  | jq -r '.siblings[].rfilename' \
  | grep '^onnx/'
```

Replace `OWNER/MODEL` with the exact repository identifier. Do not include angle brackets.

Validate the downloader script:

```bash
python3 -m py_compile scripts/validate_and_download_model.py
```

Download and validate a model:

```bash
python3 scripts/validate_and_download_model.py \
  OWNER/MODEL
```

The model must be placed under the configured `downloadDirectory`. Restart the development server after adding or removing models so the UI reloads the model list.

---

## 7. Development Commands

Start development mode:

```bash
npm run dev
```

Create a production build:

```bash
rm -rf .next
npm run build
```

Start the production server:

```bash
npm run start
```

Run the configured linter:

```bash
npm run lint
```

Inspect available scripts:

```bash
npm run
```

If a test script exists in `package.json`, run it with:

```bash
npm test
```

SQLens currently does not define a database migration or schema-sync workflow. SQL schema changes must be reviewed and tested in the target SQL Server environment separately.

---

## 8. API Smoke Test

Start the application, then run:

```bash
curl -s -X POST http://localhost:3000/api/review \
  -H 'Content-Type: application/json' \
  -d '{
    "modelId": "OWNER/MODEL",
    "sql": "CREATE PROCEDURE dbo.Test AS SELECT 1;"
  }' | jq
```

A successful response contains:

```json
{
  "model": "OWNER/MODEL",
  "promptPath": "data/prompts/analysisSP.md",
  "result": {
    "summary": "string",
    "issues": [],
    "rewrittenProcedure": "string",
    "confidence": 0
  }
}
```

---

## 9. Architecture and Coding Standards

### Runtime boundaries

- Browser code belongs in `src/app/review/page.tsx`.
- Filesystem and model operations belong in server-side code.
- API behavior belongs in `src/app/api/review/route.ts`.
- Shared model discovery belongs in `src/lib/installed-models.ts`.
- Runtime configuration belongs in `data/appconfig.json`.

Do not expose Hugging Face tokens or local filesystem implementation details to browser code.

### State management

The Review page uses local React state for:

- Available models.
- Selected model.
- SQL input.
- Loading state.
- Error state.
- Structured analysis result.

Keep API result types synchronized between the route and the client.

### Model handling

- Use exact model IDs.
- Validate model directories before exposing them in the dropdown.
- Ignore temporary and incomplete downloads.
- Do not infer ONNX compatibility from `config.json` alone.
- Do not rename Safetensors or GGUF files to ONNX filenames.

### Prompt handling

- Treat submitted SQL as untrusted text.
- Do not execute submitted SQL.
- Require evidence-based findings.
- Do not invent schema, indexes, execution plans, runtime metrics, or vulnerabilities.
- Keep the response schema stable.
- Validate generated JSON before returning it to the client.

### Error handling

API errors should provide an appropriate HTTP status and a concise safe message. Diagnostic model output may be logged locally, but SQL and secrets must not be written to logs unnecessarily.

---

## 10. Testing Expectations

Before submitting changes:

```bash
python3 -m py_compile scripts/validate_and_download_model.py
npm run lint
rm -rf .next
npm run build
```

For model changes:

1. Verify the exact Hugging Face repository ID.
2. Confirm the repository contains ONNX files.
3. Validate the download.
4. Confirm the model appears in the Review dropdown.
5. Submit a minimal stored procedure.
6. Test malformed and incomplete model output.
7. Confirm the API returns structured JSON.

For prompt changes:

1. Test a valid simple procedure.
2. Test a procedure with dynamic SQL.
3. Test transaction and error-handling logic.
4. Test empty and malformed input.
5. Confirm findings remain evidence-based.
6. Confirm the rewritten procedure remains valid T-SQL.

---

## 11. Troubleshooting

### Model is not listed

Check:

- `data/appconfig.json`.
- The expanded download directory.
- The model directory contains `config.json`.
- The model directory contains a compatible ONNX file.
- The model metadata contains the expected model ID.
- Temporary failed-download directories have been excluded.

### HTTP 401 from Hugging Face

The token is missing, expired, invalid, or lacks repository access.

```bash
echo "${HF_TOKEN:+HF_TOKEN is set}"
```

Do not print the token itself.

### HTTP 404 from Hugging Face

The repository ID or casing is incorrect, or the repository no longer exists.

### Safetensors or GGUF files were downloaded

The repository is not compatible with the current ONNX runtime. Remove the incomplete directory and select a repository containing compatible ONNX assets.

### Model output is invalid JSON

The model may be too small, the output may be truncated, or the prompt may be too large. Inspect the API diagnostic response and reduce output complexity or use a larger compatible instruction-tuned ONNX model.

### React reports that an object is not a valid child

The API returns a structured `result` object. Render its fields individually instead of rendering `{result}` directly.

---

## 12. Contribution Protocol

Create focused branches using a descriptive name:

```text
feature/model-discovery
fix/review-json-parser
docs/developer-guide
```

Keep commits focused and use imperative messages:

```text
Add ONNX model discovery
Validate structured review responses
Document model download workflow
```

Before opening a pull request:

- Run linting.
- Run the production build.
- Run Python syntax validation when changing the downloader.
- Update affected documentation.
- Avoid committing model files, tokens, logs, or local configuration.
- Include testing steps and known limitations.
- Keep API and prompt schema changes explicitly documented.

Pull requests should receive review for correctness, security, model compatibility, and backward compatibility.

---

## 13. Security and Privacy

- Never commit Hugging Face tokens.
- Store tokens only in environment variables or an approved secret manager.
- Treat submitted SQL as sensitive.
- Do not send SQL to external services unless explicitly intended and documented.
- Do not execute submitted SQL.
- Review downloaded model licenses before redistribution.
- Keep downloaded model files out of source control.
- Revoke tokens immediately if they are exposed.

---

## 14. Known Limitations

Analysis quality depends on the selected local model. SQL text alone cannot reliably establish:

- Actual execution plans.
- Existing indexes.
- Schema metadata.
- Data volume.
- Runtime locking behavior.
- Parameter distributions.
- Production security configuration.

Recommendations requiring runtime evidence should be verified with execution plans, `STATISTICS IO`, `STATISTICS TIME`, representative test data, concurrency testing, and database security review.

## Documentation Accuracy

This guide describes the repository as implemented. When files, routes, scripts,
configuration keys, or runtime behavior change, update this guide and the relevant
document under `docs/`.

Do not document an endpoint, npm script, test command, directory, or configuration
option unless it exists in the current repository.

Generate the current tracked file list with:

```bash
git ls-files
```

Inspect available npm scripts with:

```bash
node -e "console.log(require('./package.json').scripts)"
```

Inspect Next.js routes with:

```bash
find src/app -type f -print | sort
```

Inspect model-related files without exposing secrets:

```bash
find downloads/models -maxdepth 3 -type f \
  ! -name '*.safetensors' \
  ! -name '*.onnx' \
  -print
```

Never include access tokens, local secret files, model weights, or personal absolute
paths in committed documentation.

## Configuration Contract

`data/appconfig.json` must be valid JSON. Example:

```json
{
  "downloadDirectory": "~/dev/dbPro/sqlens/downloads/models"
}
```

The application reads `downloadDirectory` at runtime and expands `~` to the current
user's home directory. Model discovery must not use a hard-coded absolute path.

## Model Installation Contract

A model is eligible for the Review dropdown only when:

1. Its directory is under the configured `downloadDirectory`.
2. Its required configuration and tokenizer files are present.
3. Its required ONNX model file is present.
4. Its metadata identifies the model consistently.
5. It is not a temporary or failed-download directory.

Safetensors-only and GGUF-only repositories are not compatible with the current
Transformers.js ONNX loading path. Renaming files does not convert their format.

Failed downloads are preserved by the downloader for diagnosis. Remove an incomplete
directory only after reviewing its validation report:

```bash
find downloads/models -name validation-error.json -print
```

## Model Identifier Contract

The model identifier supplied by the client must match the installed model metadata
exactly, including owner, repository name, punctuation, and casing.

The directory name is storage-specific and must not be treated as the authoritative
model identifier when `sqlens-model.json` provides one.

## Review Processing Contract

The review flow is:

1. The client requests the available installed models.
2. The server reads the configured model directory.
3. The client submits `modelId` and SQL text.
4. The server loads the selected local ONNX model.
5. The server loads `data/prompts/analysisSP.md`.
6. The server generates model output.
7. The server extracts and validates one JSON object.
8. The client renders structured result fields.

Submitted SQL is treated as text. SQLens does not execute, migrate, or submit the
procedure to SQL Server.

## Response and Error Contract

Successful responses contain the selected model and structured analysis.

The client must render structured result fields individually. It must not render the
complete result object directly as a React child.

Expected failure categories include:

- Invalid request input.
- Model not installed.
- Model incompatible with the runtime.
- Empty model output.
- Invalid model JSON.
- Unexpected server or filesystem failure.

Error responses must not expose access tokens, model credentials, or unnecessary
local filesystem details.

## Verified Commands

Use only commands defined in `package.json`:

```bash
npm run
```

Before submitting changes, run the commands that actually exist:

```bash
python3 -m py_compile scripts/validate_and_download_model.py
npm run build
```

Run linting and tests only when corresponding scripts are present in `package.json`.

There is currently no documented SQL Server migration or schema-sync workflow in
SQLens. Database validation must be performed separately in an appropriate test
environment.

## Application Areas

### Review

The review workflow uses `src/app/review/page.tsx`, `ReviewPanel.tsx`,
`src/app/api/review/route.ts`, and the prompts under `data/prompts/`.

### Analysis and auditing

- `api/analysis/route.ts` provides analysis operations.
- `api/audit/route.ts` handles audit-oriented analysis.
- `audit-analyzer.ts` performs audit analysis.
- `datadog-analyzer.ts` integrates Datadog-related analysis behavior.

### SQL execution and comparison

- `api/execute/route.ts` handles execution requests.
- `sp-executor.ts` contains stored-procedure execution logic.
- `api/compare/route.ts` supports comparison requests.
- `compare/page.tsx` provides the comparison interface.

Execution features require explicit security review because submitted SQL may affect a database.

### Authentication and sharing

- `auth/login`, `auth/logout`, and `auth/me` implement authentication endpoints.
- `share/[token]/route.ts` handles shared analysis access.
- `share/[token]/page.tsx` renders shared results.

Tokens and session data must never be logged or exposed in client responses.

### Model management

- `models/download/route.ts` starts model downloads.
- `models/refresh/route.ts` refreshes model state.
- `review/models/route.ts` lists models available to the Review workflow.
- `manage-models/page.tsx` provides model-management UI.
- `huggingface-download.ts` handles Hugging Face downloads.
- `model-validation.ts` and `validate-model.ts` validate model files.
- `model-store.ts`, `model-path.ts`, and `installed-models.ts` manage local model discovery and paths.
- `ai-transformer.ts` provides the local inference integration.

### Application configuration

- `app-config.ts` loads application configuration.
- `data/appconfig.json` defines `downloadDirectory`.
- Model discovery must use this configured directory rather than a hard-coded path.

### Database boundary

- `src/db/index.ts` is the database access boundary.
- `prisma.config.ts` configures Prisma-related tooling.
- No Prisma schema or migration directory is currently present in the tracked repository.
- Do not document migrations until schema and migration files are added.

## Prompt Files

- `analysisSP.md` — standard stored-procedure review prompt.
- `analysisSP-verylarge.md` — larger-context review prompt.
- `explainStatistic.md` — statistics or execution-analysis prompt.

Prompt changes can alter response structure and model behavior. Update API parsing and UI types when the prompt schema changes.

## Actual Development Checks

The repository currently has no tracked test files. Inspect available package scripts before running commands:

```bash
node -e "console.log(require('./package.json').scripts)"
```

Run only scripts defined there. At minimum, validate the downloader and production build:

```bash
python3 -m py_compile scripts/validate_and_download_model.py
npm run build
```

Do not claim that migrations, unit tests, or linting are available unless the corresponding files or npm scripts exist.

## Documentation Maintenance

After changing routes, pages, prompt files, model behavior, configuration, or package scripts:

1. Update this guide.
2. Update `docs/architecture.md` and the relevant specialized guide.
3. Update the documentation index in `README.md`.
4. Run link and build checks.
5. Add newly created documentation files to Git.

Check documentation status:

```bash
git status --short docs
git add docs
```

## Development Do's and Don'ts

### Do

- Read `AGENTS.md` before modifying Next.js code.
- Review the relevant Next.js guidance under `node_modules/next/dist/docs/` before changing framework APIs or conventions.
- Keep filesystem, model, and database operations in server-side modules.
- Read `downloadDirectory` from `data/appconfig.json`; do not hard-code local paths.
- Validate model identifiers, model metadata, downloaded files, and ONNX compatibility.
- Treat SQL input as untrusted text.
- Validate and sanitize API input and model-generated JSON.
- Keep prompt changes synchronized with API parsing and UI rendering.
- Run the applicable build, lint, test, and Python validation commands before submitting changes.
- Update relevant documentation when routes, configuration, prompts, scripts, or workflows change.
- Keep secrets, model weights, generated files, and local configuration out of Git.
- Use focused branches and commits.
- Preserve failed model-download reports for diagnosis.

### Don't

- Do not assume current Next.js behavior from prior versions.
- Do not modify framework APIs without consulting the installed Next.js documentation.
- Do not execute submitted SQL without explicit authorization and safety controls.
- Do not expose SQL text, credentials, access tokens, connection strings, or local paths in logs or responses.
- Do not render an entire response object directly as a React child.
- Do not treat a directory containing only `config.json` as a valid model.
- Do not rename Safetensors, GGUF, or MLX files to ONNX filenames.
- Do not use hard-coded developer-specific paths.
- Do not commit `keys.md`, `.env*`, Hugging Face tokens, model files, `.next/`, `node_modules/`, or Python cache files.
- Do not claim an endpoint, script, migration, test, or feature is implemented solely because a filename exists.
- Do not change prompt output schemas without updating validation, types, UI code, and documentation.
- Do not delete failed downloads before reviewing their validation report.
- Do not bypass authentication or authorization checks for convenience.
- Do not commit generated changes without reviewing `git diff`.
- Do not mark a roadmap feature `[COMPLETED]` without runtime verification.

### Required checks

```bash
git diff --check
npm run
npm run build
python3 -m py_compile scripts/validate_and_download_model.py
```

Run linting and tests only when the corresponding scripts exist in `package.json`.

Before committing:

```bash
git status --short
git diff --stat
git diff --cached --check
```

## Agent and Documentation Maintenance

`AGENTS.md` is the authoritative guide for automated coding agents. `CLAUDE.md`
delegates to it and should not duplicate its rules.

When repository behavior changes, update the appropriate documentation and verify
that README links resolve. Keep roadmap statuses evidence-based and do not document
unverified routes, scripts, migrations, or runtime behavior.