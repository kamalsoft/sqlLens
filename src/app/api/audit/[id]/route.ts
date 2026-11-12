import { NextResponse } from "next/server";
import { deleteAudit, getAudit, getFeedback, relatedAudits } from "@/db/audit-repo";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { rateLimit } from "@/lib/request-guard";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const record = getAudit(id, auth.session.sessionId);
    if (!record) return NextResponse.json({ error: "Audit record not found" }, { status: 404 });
    return NextResponse.json(
      { ...record, feedback: getFeedback(record.id), related: relatedAudits(record, auth.session.sessionId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError("[audit/[id]/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** SEC-T4: deletes one of the user's own records, with its feedback and share link. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  if (!rateLimit(`audit-delete:${auth.session.sessionId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }
  try {
    const { id } = await params;
    if (!deleteAudit(id, auth.session.sessionId)) {
      return NextResponse.json({ error: "Audit record not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    logError("[audit/[id]/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
