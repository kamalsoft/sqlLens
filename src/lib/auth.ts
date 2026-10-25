import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import db from "@/db";

export const SESSION_COOKIE = "session_token";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export type SessionInfo = { sessionId: string; userId: string; username: string };

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO sessions (id, user_id, token, is_active, expires_at) VALUES (?, ?, ?, 1, ?)"
  ).run(randomUUID(), userId, token, expiresAt);
  return { token, expiresAt };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export function getSessionFromRequest(request: Request): SessionInfo | null {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS sessionId, s.user_id AS userId, u.username AS username, s.expires_at AS expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.is_active = 1`
    )
    .get(token) as
    | { sessionId: string; userId: string; username: string; expiresAt: string | null }
    | undefined;
  if (!row) return null;
  const expires = row.expiresAt ? Date.parse(row.expiresAt) : NaN;
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  db.prepare("UPDATE sessions SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.sessionId);
  return { sessionId: row.sessionId, userId: row.userId, username: row.username };
}

export function requireSession(
  request: Request
): { ok: true; session: SessionInfo } | { ok: false; response: NextResponse } {
  const session = getSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

export function invalidateSession(token: string): void {
  db.prepare("UPDATE sessions SET is_active = 0 WHERE token = ?").run(token);
}

export function getSessionToken(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE);
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
