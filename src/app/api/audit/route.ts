import { NextResponse } from "next/server";
import { listAudits } from "@/db/audit-repo";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/redact";

export async function GET(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ audits: listAudits(auth.session.sessionId) });
  } catch (error) {
    logError("[audit/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
