import { describe, expect, it } from "vitest";
import db from "@/db";
import {
  createSession,
  getSessionFromRequest,
  invalidateSession,
  requireSession,
  SESSION_TTL_MS,
} from "@/lib/auth";
import { seedAdmin } from "../helpers/auth";

const req = (token?: string) =>
  new Request("http://localhost/x", { headers: token ? { cookie: `a=b; session_token=${token}` } : {} });

describe("auth sessions", () => {
  it("creates and resolves a session", () => {
    const userId = seedAdmin();
    const { token, expiresAt } = createSession(userId);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(SESSION_TTL_MS - 5000);
    expect(getSessionFromRequest(req(token))?.username).toBe("admin");
  });
  it("rejects missing, unknown, expired and invalidated tokens", () => {
    const userId = seedAdmin();
    expect(getSessionFromRequest(req())).toBeNull();
    expect(getSessionFromRequest(req("nope"))).toBeNull();
    const { token } = createSession(userId);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      token
    );
    expect(getSessionFromRequest(req(token))).toBeNull();
    const second = createSession(userId);
    invalidateSession(second.token);
    expect(getSessionFromRequest(req(second.token))).toBeNull();
  });
  it("requireSession returns 401 without a session", async () => {
    const r = requireSession(req());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      expect(await r.response.json()).toEqual({ error: "Authentication required" });
    }
  });
});
