import { NextResponse } from "next/server";
import { createShare, getAudit, revokeShare } from "@/db/audit-repo";
import { readAppConfig } from "@/lib/app-config";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { badRequest } from "@/lib/validation/body";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!getAudit(id, auth.session.sessionId)) {
      return NextResponse.json({ error: "Audit record not found" }, { status: 404 });
    }
    let body: unknown = {};
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return badRequest("Request body must be valid JSON");
      }
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return badRequest("Request body must be a JSON object");
    }
    let ttlHours = (await readAppConfig()).shareTtlHours;
    const requested = (body as Record<string, unknown>).ttlHours;
    if (requested !== undefined) {
      if (typeof requested !== "number" || !Number.isFinite(requested) || requested < 1 || requested > 720) {
        return badRequest("ttlHours must be a number between 1 and 720", "ttlHours");
      }
      ttlHours = requested;
    }
    const { token, expiresAt } = createShare(id, ttlHours);
    return NextResponse.json({ url: `/share/${token}`, expiresAt });
  } catch (error) {
    logError("[audit/share]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!getAudit(id, auth.session.sessionId)) {
      return NextResponse.json({ error: "Audit record not found" }, { status: 404 });
    }
    revokeShare(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("[audit/share]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
