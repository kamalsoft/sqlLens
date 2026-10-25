import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import db from "@/db";
import { auditStats, getAudit, insertAudit, listAudits } from "@/db/audit-repo";
import { runMigrations } from "@/db/migrate";
import { GET as auditGet } from "@/app/api/audit/route";
import { GET as auditById } from "@/app/api/audit/[id]/route";
import { GET as analysis } from "@/app/api/analysis/route";
import { createSession } from "@/lib/auth";
import { seedAdmin } from "../helpers/auth";

function sessionFor(): { sessionId: string; cookie: string } {
  const userId = seedAdmin();
  const { token } = createSession(userId);
  const row = db.prepare("SELECT id FROM sessions WHERE token = ?").get(token) as { id: string };
  return { sessionId: row.id, cookie: `session_token=${token}` };
}

describe("audit-repo", () => {
  it("inserts, lists, gets, isolates owners and numbers records", () => {
    const a = sessionFor();
    const b = sessionFor();
    const r1 = insertAudit({ sessionId: a.sessionId, type: "EXECUTE", request: { sql: "x" }, response: { ok: 1 }, engine: "mssql", elapsedMs: 10, logicalReads: 5 });
    const r2 = insertAudit({ sessionId: b.sessionId, type: "REVIEW", request: {}, response: {}, schemaVersion: "v2", modelId: "m" });
    expect(r2.recordNumber).toBe(r1.recordNumber + 1);
    const rec = getAudit(r1.id, a.sessionId);
    expect(rec).toMatchObject({ type: "EXECUTE", engine: "mssql", simulated: false, status: "ok", hasShare: false, elapsedMs: 10, logicalReads: 5, request: { sql: "x" } });
    expect(getAudit(r1.id, b.sessionId)).toBeNull();
    expect(listAudits(a.sessionId).map((x) => x.id)).toEqual([r1.id]);
    expect(getAudit(r2.id, b.sessionId)?.schemaVersion).toBe("v2");
  });
  it("stats exclude simulated rows", () => {
    const a = sessionFor();
    insertAudit({ sessionId: a.sessionId, type: "EXECUTE", request: {}, response: {}, elapsedMs: 100, logicalReads: 10 });
    insertAudit({ sessionId: a.sessionId, type: "EXECUTE", request: {}, response: {}, elapsedMs: 300, logicalReads: 20 });
    insertAudit({ sessionId: a.sessionId, type: "EXECUTE", request: {}, response: {}, simulated: true, elapsedMs: 9999, logicalReads: 999 });
    insertAudit({ sessionId: a.sessionId, type: "EXECUTE", request: {}, response: {}, status: "error" });
    const s = auditStats(a.sessionId);
    expect(s).toMatchObject({ total: 3, completed: 2, averageElapsedMs: 200, totalLogicalReads: 30 });
    expect(s.recent.every((x) => !x.simulated)).toBe(true);
  });
  it("routes: audit list, audit/[id] owner/non-owner/401, analysis", async () => {
    const a = sessionFor();
    const b = sessionFor();
    const { id } = insertAudit({ sessionId: a.sessionId, type: "COMPARE", request: {}, response: { r: 1 } });
    const h = (cookie?: string) => new Request("http://localhost/api/x", { headers: cookie ? { cookie } : {} });
    const ctx = { params: Promise.resolve({ id }) };
    expect((await auditById(h(a.cookie), ctx)).status).toBe(200);
    expect((await auditById(h(b.cookie), ctx)).status).toBe(404);
    expect((await auditById(h(), ctx)).status).toBe(401);
    expect((await (await auditGet(h(a.cookie))).json()).audits).toHaveLength(1);
    expect((await analysis(h())).status).toBe(401);
    const stats = await (await analysis(h(a.cookie))).json();
    expect(stats.total).toBe(1);
  });
});

describe("migration 003 on existing data", () => {
  it("backfills record_number and keeps rows", () => {
    const dir = fs.mkdtempSync(path.join(process.env.SQLLENS_DB_DIR!, "mig-"));
    const old = new Database(path.join(dir, "t.db"));
    const migs = path.resolve(__dirname, "../../src/db/migrations");
    const only = path.join(dir, "m");
    fs.mkdirSync(only);
    for (const f of ["001_baseline.sql", "002_auth.sql"]) fs.copyFileSync(path.join(migs, f), path.join(only, f));
    runMigrations(old, only);
    old.prepare("INSERT INTO users (id, username, password_hash) VALUES ('u','u','h')").run();
    old.prepare("INSERT INTO sessions (id, user_id, token) VALUES ('s','u','t')").run();
    const ins = old.prepare("INSERT INTO audit_requests (id, session_id, type, request_payload, response_payload, shared_token, created_at) VALUES (?, 's', 'COMPARE', '{}', '{}', ?, ?)");
    ins.run("c", "tok", "2026-01-03 00:00:00");
    ins.run("a", null, "2026-01-01 00:00:00");
    ins.run("b", null, "2026-01-02 00:00:00");
    fs.copyFileSync(path.join(migs, "003_execution_metadata.sql"), path.join(only, "003_execution_metadata.sql"));
    expect(runMigrations(old, only)).toEqual(["003_execution_metadata.sql"]);
    const rows = old.prepare("SELECT id, record_number, simulated, status, shared_token FROM audit_requests ORDER BY record_number").all();
    expect(rows).toEqual([
      { id: "a", record_number: 1, simulated: 0, status: "ok", shared_token: null },
      { id: "b", record_number: 2, simulated: 0, status: "ok", shared_token: null },
      { id: "c", record_number: 3, simulated: 0, status: "ok", shared_token: "tok" },
    ]);
    old.close();
  });
});
