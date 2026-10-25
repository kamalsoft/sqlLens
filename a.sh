#!/usr/bin/env bash
# find_review_details.sh
# --------------------------------------------------------------
# Script to locate and display the key files and directories
# related to the `/review` feature in this Next.js project.
# --------------------------------------------------------------

set -euo pipefail

# 1️⃣  Project root directories (skip generated / large folders)
echo "=== Project root directories ==="
find . -mindepth 1 -maxdepth 1 -type d \
  ! -path "./node_modules" \
  ! -path "./.next" \
  ! -path "./.venv" \
  ! -path "./.git" \
  ! -path "./.storybook" \
  ! -path "./audit_logs" \
  ! -path "./data" \
  ! -path "./downloads" \
  ! -path "./public" \
  ! -path "./scripts" \
  ! -path "./src" \
  | sort

# 2️⃣  Review‑related file paths (components, API, etc.)
echo "=== Review‑related file paths ==="
find . -type f \
  \( -name "*review*" \
   -o -path "*/api/*review*" \
   -o -path "*/components/*review*" \) \
  | sort

# 3️⃣  API route files that contain the word “review” (likely the endpoint)
echo "=== API route files containing “review” ==="
grep -R "review" ./src/app ./src/pages | grep -i "api" | cut -d: -f1 | sort -u

# 4️⃣  UI components that reference the `/review` route (links, href, <Link>)
echo "=== UI components referencing /review ==="
grep -R "/review" ./src/components ./src/app | grep -i -E "href|Link|a" | \
  grep -o "\"[^\"]*\"" | tr -d '"' | sort -u

# 5️⃣  Service / transformer files that the review logic probably uses
echo "=== Service / transformer files ==="
find . -type f \( -name "*transformer*" -o -name "*analyzer*" \) | sort

# 6️⃣  Show the first 20 lines of the most relevant files (quick context)
echo "=== Key file excerpts (first 20 lines) ==="
for f in \
  src/components/review/ReviewPanel.tsx \
  src/lib/ai-transformer.ts \
  src/lib/datadog-analyzer.ts \
  src/components/layout/Navbar.tsx \
  src/app/api/review/route.ts \
  src/app/api/review/models/route.ts; do
  if [[ -f "$f" ]]; then
    echo "--- $f ---"
    head -n 20 "$f"
    echo
  fi
doneconst rawResult = output[0]?.generated_text?.trim();

if (!rawResult) {
  console.error('❌ Model returned empty text');
  return NextResponse.json(
    { error: "Model returned no text", model: model.id },
    { status: 502 },
  );
}

// optional: log the first few lines for debugging
console.debug('🧩 Raw model output (first 200 chars):', rawResult.slice(0, 500));

try {
  const result = extractJson(rawResult);
  // …rest unchanged
} catch (parseErr) {
  console.error('❌ JSON parse failed', parseErr);
  console.debug('Raw response:', rawResult);
  return NextResponse.json(
    {
      error: "Unable to parse model response",
      details: {
        model: model.id,
        rawLength: rawResult.length,
        rawPreview: rawResult.slice(0, 500),
        rawTail: rawResult.slice(-500),
      },
    },
    { status: 502 },
  );
}