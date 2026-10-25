import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { logError } from "@/lib/redact";

export async function GET(request: Request) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) return NextResponse.json({ authenticated: false });
    return NextResponse.json({
      authenticated: true,
      user: { id: session.userId, username: session.username },
    });
  } catch (error) {
    logError("[auth/me]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
