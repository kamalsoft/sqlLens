import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getInstalledModels } from "@/lib/installed-models";
import { logError } from "@/lib/redact";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({ models: await getInstalledModels() });
  } catch (error) {
    logError("Listing installed models failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
