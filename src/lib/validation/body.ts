import { NextResponse } from "next/server";

export function isString(v: unknown): v is string {
  return typeof v === "string";
}
export function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

export function badRequest(error: string, field?: string): NextResponse {
  return NextResponse.json(field ? { error, field } : { error }, { status: 400 });
}

export async function readJson(
  request: Request
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false, response: badRequest("Request body must be valid JSON") };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, response: badRequest("Request body must be a JSON object") };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}
