import { describe, expect, it } from "vitest";
import db from "@/db";
import { hashPlainSessionTokens } from "@/db/session-tokens";
import { getSessionFromRequest, hashToken } from "@/lib/auth";
import { seedAdmin } from "../helpers/auth";

describe("legacy plain-text session tokens (SEC-T6)", () => {
  it("are hashed in place, so the existing cookie keeps working", () => {
    const userId = seedAdmin();
    const plain = "legacy-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    db.prepare("INSERT INTO sessions (id, user_id, token, is_active, expires_at) VALUES (?, ?, ?, 1, ?)")
      .run("legacy-session", userId, plain, new Date(Date.now() + 60_000).toISOString());
    expect(hashPlainSessionTokens(db)).toBeGreaterThanOrEqual(1);
    expect(db.prepare("SELECT token FROM sessions WHERE id = 'legacy-session'").get()).toEqual({ token: hashToken(plain) });
    const req = new Request("http://localhost/x", { headers: { cookie: `session_token=${plain}` } });
    expect(getSessionFromRequest(req)?.sessionId).toBe("legacy-session");
    expect(hashPlainSessionTokens(db)).toBe(0);
  });
});
