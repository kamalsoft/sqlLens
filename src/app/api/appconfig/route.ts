import { NextResponse } from "next/server";
import { readAppConfig, validateConfigChanges, writeAppConfig } from "@/lib/app-config";
import { requireSession } from "@/lib/auth";
import { rateLimit } from "@/lib/request-guard";
import { logError } from "@/lib/redact";
import { readJson } from "@/lib/validation/body";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await readAppConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  if (!rateLimit(`settings:${auth.session.sessionId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }
  try {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;

    const validated = validateConfigChanges(parsed.body);
    if (!validated.ok) {
      return NextResponse.json(
        { error: `Invalid value for ${validated.field}`, field: validated.field },
        { status: 400 }
      );
    }

    const config = await writeAppConfig(validated.changes);
    return NextResponse.json(config, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("[appconfig/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
