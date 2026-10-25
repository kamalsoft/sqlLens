import { NextResponse } from "next/server";
import { insertAudit } from "@/db/audit-repo";
import { compareStoredProcedures } from "@/lib/ai-transformer";
import { requireSession } from "@/lib/auth";
import { readAppConfig } from "@/lib/app-config";
import { logError } from "@/lib/redact";
import { readJson } from "@/lib/validation/body";
import { validateSqlInput } from "@/lib/validation/sql-input";

export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const { maxSqlLength } = await readAppConfig();

    const original = validateSqlInput(parsed.body.original, maxSqlLength);
    if (!original.ok) {
      return NextResponse.json({ error: original.error, field: "original" }, { status: 400 });
    }
    const optimized = validateSqlInput(parsed.body.optimized, maxSqlLength);
    if (!optimized.ok) {
      return NextResponse.json({ error: optimized.error, field: "optimized" }, { status: 400 });
    }

    const result = await compareStoredProcedures(original.sql, optimized.sql);

    const { id } = insertAudit({
      sessionId: auth.session.sessionId,
      type: "COMPARE",
      request: { original: original.sql, optimized: optimized.sql },
      response: result,
    });

    return NextResponse.json({ id, sharedToken: null, result });
  } catch (error) {
    logError("[compare/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
