import { NextResponse } from "next/server";
import { getAudit, getFeedback } from "@/db/audit-repo";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/redact";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const record = getAudit(id, auth.session.sessionId);
    if (!record) return NextResponse.json({ error: "Audit record not found" }, { status: 404 });
    return NextResponse.json({ ...record, feedback: getFeedback(record.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("[audit/[id]/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
