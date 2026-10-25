import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import db from "@/db";
import { insertAudit, listAudits } from "@/db/audit-repo";
import { runMigrations } from "@/db/migrate";
import { GET as auditById } from "@/app/api/audit/[id]/route";
import { PATCH as patchRecs } from "@/app/api/audit/[id]/recommendations/route";
import { DELETE as unshare, POST as share } from "@/app/api/audit/[id]/share/route";
import { GET as getShared } from "@/app/api/share/[token]/route";
import { createSession } from "@/lib/auth";
import { seedAdmin } from "../helpers/auth";

function sessionFor(): { sessionId: string; cookie: string } {
  const { token } = createSession(seedAdmin());
  const row = db.prepare("SELECT id FROM sessions WHERE token = ?").get(token) as { id: string };
  return { sessionId: row.id, cookie: `session_token=${token}` };
}
const call = (method: string, body?: unknown, cookie?: string) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("recommendation feedback", () => {
  it("upserts, validates, isolates owners, requires session", async () => {
    const a = sessionFor();
    const b = sessionFor();
    const { id } = insertAudit({ sessionId: a.sessionId, type: "REVIEW", request: {}, response: {} });
    const patch = (body: unknown, cookie?: string) => patchRecs(call("PATCH", body, cookie), ctx(id));

    expect((await patch({ items: [] })).status).toBe(401);
    expect((await patch({ items: [{ key: "k", status: "accepted" }] }, b.cookie)).status).toBe(404);

    expect((await patch({ items: [{ key: "findingsTable:0", status: "accepted", note: "ok" }] }, a.cookie)).status).toBe(200);
    expect((await patch({ items: [{ key: "findingsTable:0", status: "rejected" }] }, a.cookie)).status).toBe(200);
    const rec = await (await auditById(call("GET", undefined, a.cookie), ctx(id))).json();
    expect(rec.feedback["findingsTable:0"]).toMatchObject({ status: "rejected", note: "ok" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM recommendation_feedback WHERE audit_id = ?").get(id)).toEqual({ n: 1 });

    const bad = async (body: unknown) => (await patch(body, a.cookie)).status;
    expect(await bad({ items: "x" })).toBe(400);
    expect(await bad({ items: Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, status: "pending" })) })).toBe(400);
    expect(await bad({ items: [{ key: "x".repeat(201), status: "pending" }] })).toBe(400);
    expect(await bad({ items: [{ key: "k", status: "maybe" }] })).toBe(400);
    expect(await bad({ items: [{ key: "k", status: "pending", note: "n".repeat(2001) }] })).toBe(400);
    const r = await patch({ items: [{ key: "k", status: "bogus" }] }, a.cookie);
    expect((await r.json()).field).toBe("items[0].status");
  });
});

describe("share links", () => {
  it("create, view, TTL bounds, revoke, expiry, owner and session checks", async () => {
    const a = sessionFor();
    const b = sessionFor();
    const { id } = insertAudit({ sessionId: a.sessionId, type: "COMPARE", request: { sql: "SECRET SQL" }, response: { r: 1 } });
    const mk = (body: unknown, cookie?: string) => share(call("POST", body, cookie), ctx(id));
    const view = (token: string, cookie?: string) =>
      getShared(call("GET", undefined, cookie), { params: Promise.resolve({ token }) });

    expect((await mk({})).status).toBe(401);
    expect((await mk({}, b.cookie)).status).toBe(404);
    expect((await mk({ ttlHours: 0 }, a.cookie)).status).toBe(400);
    expect((await mk({ ttlHours: 721 }, a.cookie)).status).toBe(400);
    expect((await mk({ ttlHours: "5" }, a.cookie)).status).toBe(400);

    const created = await (await mk({ ttlHours: 2 }, a.cookie)).json();
    expect(created.url).toMatch(/^\/share\/[A-Za-z0-9_-]{43}$/);
    const hours = (Date.parse(created.expiresAt) - Date.now()) / 3600000;
    expect(hours).toBeGreaterThan(1.99);
    expect(hours).toBeLessThanOrEqual(2);
    expect(listAudits(a.sessionId)[0].hasShare).toBe(true);
    const detail = await (await auditById(call("GET", undefined, a.cookie), ctx(id))).json();
    expect(detail).toMatchObject({ shared: true, shareExpiresAt: created.expiresAt });
    const listed = listAudits(a.sessionId)[0];
    expect(listed).toMatchObject({ shared: true, shareExpiresAt: created.expiresAt });
    expect(JSON.stringify(listed) + JSON.stringify(detail)).not.toContain(created.url.split("/")[2]);

    const token = created.url.split("/")[2];
    expect((await view(token)).status).toBe(401);
    const ok = await view(token, b.cookie);
    expect(ok.status).toBe(200);
    const text = JSON.stringify(await ok.json());
    expect(text).not.toMatch(/SECRET SQL|request/);

    // default TTL from config
    const def = await (await mk(undefined, a.cookie)).json();
    expect((Date.parse(def.expiresAt) - Date.now()) / 3600000).toBeGreaterThan(23.9);

    expect((await unshare(call("DELETE", undefined, b.cookie), ctx(id))).status).toBe(404);
    expect((await unshare(call("DELETE", undefined, a.cookie), ctx(id))).status).toBe(200);
    expect((await view(def.url.split("/")[2], a.cookie)).status).toBe(404);
    expect(listAudits(a.sessionId)[0]).toMatchObject({ hasShare: false, shared: false, shareExpiresAt: null });

    const again = await (await mk({}, a.cookie)).json();
    db.prepare("UPDATE audit_requests SET share_expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), id);
    expect((await view(again.url.split("/")[2], a.cookie)).status).toBe(410);
    expect(listAudits(a.sessionId)[0].hasShare).toBe(false);
    expect((await view("unknown", a.cookie)).status).toBe(404);
  });
});

describe("migrations 004 and 005 on existing data", () => {
  it("keep rows; legacy token has NULL expiry and is treated as expired", () => {
    const dir = fs.mkdtempSync(path.join(process.env.SQLLENS_DB_DIR!, "mig45-"));
    const migs = path.resolve(__dirname, "../../src/db/migrations");
    const only = path.join(dir, "m");
    fs.mkdirSync(only);
    const copy = (names: string[]) => names.forEach((f) => fs.copyFileSync(path.join(migs, f), path.join(only, f)));
    copy(["001_baseline.sql", "002_auth.sql", "003_execution_metadata.sql"]);
    const old = new Database(path.join(dir, "t.db"));
    runMigrations(old, only);
    old.prepare("INSERT INTO users (id, username, password_hash) VALUES ('u','u','h')").run();
    old.prepare("INSERT INTO sessions (id, user_id, token) VALUES ('s','u','t')").run();
    old.prepare("INSERT INTO audit_requests (id, session_id, type, request_payload, response_payload, shared_token) VALUES ('legacy','s','COMPARE','{}','{}','oldtok')").run();
    copy(["004_recommendation_feedback.sql", "005_share.sql"]);
    expect(runMigrations(old, only)).toEqual(["004_recommendation_feedback.sql", "005_share.sql"]);
    expect(old.prepare("SELECT shared_token, share_expires_at, share_revoked FROM audit_requests WHERE id='legacy'").get()).toEqual({
      shared_token: "oldtok",
      share_expires_at: null,
      share_revoked: 0,
    });
    old.prepare("INSERT INTO recommendation_feedback (id, audit_id, rec_key, status, user_id) VALUES ('f','legacy','k','pending','u')").run();
    expect(() =>
      old.prepare("INSERT INTO recommendation_feedback (id, audit_id, rec_key, status, user_id) VALUES ('g','legacy','k','pending','u')").run()
    ).toThrow();
    expect(() =>
      old.prepare("INSERT INTO recommendation_feedback (id, audit_id, rec_key, status, user_id) VALUES ('h','legacy','k2','bad','u')").run()
    ).toThrow();
    old.close();
  });
});
