import { NextResponse } from "next/server";
import { lookupShare } from "@/db/audit-repo";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/redact";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { token } = await params;
    const found = lookupShare(token);
    if (found.state === "not_found") {
      return NextResponse.json({ error: "Shared result not found" }, { status: 404 });
    }
    if (found.state === "expired") {
      return NextResponse.json({ error: "Share link has expired" }, { status: 410 });
    }
    return NextResponse.json({
      id: found.id,
      type: found.type,
      createdAt: found.createdAt,
      result: found.result,
      expiresAt: found.expiresAt,
    });
  } catch (error) {
    logError("[share/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
