import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionToken, invalidateSession } from "@/lib/auth";
import { logError } from "@/lib/redact";

export async function POST(request: Request) {
  try {
    const token = getSessionToken(request);
    if (token) invalidateSession(token);
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    logError("[auth/logout]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
