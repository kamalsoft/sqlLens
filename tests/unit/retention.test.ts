import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db from "@/db";
import { getAudit, insertAudit, purgeExpired, upsertFeedback } from "@/db/audit-repo";
import { DELETE as auditDelete } from "@/app/api/audit/[id]/route";
import { defaultAppConfig } from "@/lib/app-config";
import { createSession, hashToken } from "@/lib/auth";
import { executeSP, purgeOldLogs } from "@/lib/sp-executor";
import { seedAdmin } from "../helpers/auth";

function sessionFor() {
  const userId = seedAdmin();
  const { token } = createSession(userId);
  const row = db.prepare("SELECT id FROM sessions WHERE token = ?").get(hashToken(token)) as { id: string };
  return { userId, sessionId: row.id, cookie: `session_token=${token}` };
}
const del = (id: string, cookie?: string) =>
  auditDelete(new Request(`http://localhost/api/audit/${id}`, { method: "DELETE", headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

describe("retention and delete (SEC-T4)", () => {
  it("defaults: 90 days, SQL text not logged", () => {
    expect(defaultAppConfig).toMatchObject({ retentionDays: 90, logSqlText: false });
  });

  it("DELETE removes only the user's own record, with its feedback", async () => {
    const a = sessionFor();
    const b = sessionFor();
    const rec = insertAudit({ sessionId: a.sessionId, type: "REVIEW", request: {}, response: {} });
    upsertFeedback(rec.id, a.userId, [{ key: "k", status: "accepted" }]);
    expect((await del(rec.id)).status).toBe(401);
    expect((await del(rec.id, b.cookie)).status).toBe(404);
    expect(getAudit(rec.id, a.sessionId)).not.toBeNull();
    expect((await del(rec.id, a.cookie)).status).toBe(200);
    expect(getAudit(rec.id, a.sessionId)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM recommendation_feedback WHERE audit_id = ?").get(rec.id)).toEqual({ n: 0 });
    expect((await del(rec.id, a.cookie)).status).toBe(404);
  });

  it("purges records older than the retention period and expired sessions no record uses", () => {
    const a = sessionFor();
    const old = insertAudit({ sessionId: a.sessionId, type: "REVIEW", request: {}, response: {} });
    const fresh = insertAudit({ sessionId: a.sessionId, type: "REVIEW", request: {}, response: {} });
    db.prepare("UPDATE audit_requests SET created_at = datetime('now', '-100 days') WHERE id = ?").run(old.id);
    const lone = sessionFor();
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id IN (?, ?)").run("2000-01-01T00:00:00.000Z", lone.sessionId, a.sessionId);

    const out = purgeExpired(90);
    expect(out.audits).toBeGreaterThanOrEqual(1);
    expect(getAudit(old.id, a.sessionId)).toBeNull();
    expect(getAudit(fresh.id, a.sessionId)).not.toBeNull();
    const left = (id: string) => db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id);
    expect(left(lone.sessionId)).toBeUndefined();
    // Still owns a record, so it stays even though it expired.
    expect(left(a.sessionId)).toBeDefined();
  });
});

describe("run logs (SEC-T4)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "sqllens-retention-"));
    process.env.SQLLENS_AUDIT_LOG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.SQLLENS_AUDIT_LOG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes logs readable by the owner only", async () => {
    await executeSP({ kind: "batch", sql: "SELECT 1" }, "SP", "simulation", undefined, { timeoutMs: 1000, logSqlText: false });
    const file = readdirSync(dir).find((f) => f.endsWith(".txt"))!;
    expect(statSync(path.join(dir, file)).mode & 0o777).toBe(0o600);
  });

  it("deletes logs older than the retention period", () => {
    writeFileSync(path.join(dir, "000001_old.txt"), "x");
    writeFileSync(path.join(dir, "000002_new.txt"), "x");
    writeFileSync(path.join(dir, "notes.md"), "x");
    writeFileSync(path.join(dir, "readme.txt"), "x");
    const longAgo = (Date.now() - 100 * 86_400_000) / 1000;
    utimesSync(path.join(dir, "000001_old.txt"), longAgo, longAgo);
    utimesSync(path.join(dir, "notes.md"), longAgo, longAgo);
    // An old .txt that is not a run log stays: the directory may be shared.
    utimesSync(path.join(dir, "readme.txt"), longAgo, longAgo);
    expect(purgeOldLogs(90)).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(["000002_new.txt", "notes.md", "readme.txt"]);
  });
});
