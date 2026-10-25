import { NextResponse } from "next/server";
import { auditStats } from "@/db/audit-repo";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/redact";

export async function GET(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const stats = auditStats(auth.session.sessionId);
    return NextResponse.json(
      {
        ...stats,
        // Legacy keys kept for the current dashboard.
        totalAnalyses: stats.total,
        completedAnalyses: stats.completed,
        recentAnalyses: stats.recent,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logError("[analysis/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
