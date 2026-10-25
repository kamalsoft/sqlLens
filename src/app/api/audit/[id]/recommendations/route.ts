import { NextResponse } from "next/server";
import { getAudit, upsertFeedback, type FeedbackItem } from "@/db/audit-repo";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { badRequest, readJson } from "@/lib/validation/body";

const STATUSES = new Set(["accepted", "rejected", "pending"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!getAudit(id, auth.session.sessionId)) {
      return NextResponse.json({ error: "Audit record not found" }, { status: 404 });
    }
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const { items } = parsed.body;
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
      return badRequest("items must be an array of 1 to 200 entries", "items");
    }
    const clean: FeedbackItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as Record<string, unknown> | null;
      const field = `items[${i}]`;
      if (it === null || typeof it !== "object" || Array.isArray(it)) return badRequest("Invalid item", field);
      if (typeof it.key !== "string" || it.key.length === 0 || it.key.length > 200) {
        return badRequest("key must be a string of 1 to 200 characters", `${field}.key`);
      }
      if (typeof it.status !== "string" || !STATUSES.has(it.status)) {
        return badRequest("status must be accepted, rejected or pending", `${field}.status`);
      }
      if (it.note !== undefined && (typeof it.note !== "string" || it.note.length > 2000)) {
        return badRequest("note must be a string of at most 2000 characters", `${field}.note`);
      }
      clean.push({ key: it.key, status: it.status as FeedbackItem["status"], note: it.note as string | undefined });
    }
    upsertFeedback(id, auth.session.userId, clean);
    return NextResponse.json({ success: true, updated: clean.length });
  } catch (error) {
    logError("[audit/recommendations]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
