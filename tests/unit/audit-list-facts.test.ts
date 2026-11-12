import { describe, expect, it } from "vitest";
import db from "@/db";
import { insertAudit, listAudits } from "@/db/audit-repo";
import { createSession, hashToken } from "@/lib/auth";
import { seedAdmin } from "../helpers/auth";

function sessionId(): string {
  const { token } = createSession(seedAdmin());
  return (db.prepare("SELECT id FROM sessions WHERE token = ?").get(hashToken(token)) as { id: string }).id;
}

describe("audit list facts (UX-4)", () => {
  it("keeps the list working when one stored record is not valid JSON", () => {
    const sid = sessionId();
    insertAudit({ sessionId: sid, type: "REVIEW", request: { sql: "select 1" }, response: { verdict: "ok" } });
    const bad = insertAudit({ sessionId: sid, type: "EXECUTE", request: {}, response: {} });
    db.prepare("UPDATE audit_requests SET response_payload = '{not json' WHERE id = ?").run(bad.id);
    const rows = listAudits(sid, 10);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === bad.id)).toMatchObject({ grade: null, verdict: null });
  });

  it("reads the procedure, grade and verdict from the stored single and compare results", () => {
    const sid = sessionId();
    insertAudit({
      sessionId: sid, type: "EXECUTE", engine: "mssql",
      request: { mode: "single", engine: "mssql", original: { kind: "procedure", name: "dbo.usp_Get", params: [{ name: "@a", type: "int" }] } },
      response: { mode: "single", execution: { outputs: {} }, analysis: { performanceGrade: "B", prodVerdict: { verdict: "READY", reason: "ok", driver: null } } },
    });
    insertAudit({
      sessionId: sid, type: "EXECUTE_COMPARE", engine: "mssql",
      request: { mode: "compare", engine: "mssql", original: { kind: "procedure", name: "dbo.usp_Old" } },
      response: { mode: "compare", original: { analysis: { performanceGrade: "D", prodVerdict: { verdict: "OPTIMIZE", reason: "r", driver: null } } } },
    });
    insertAudit({ sessionId: sid, type: "REVIEW", request: { sql: "select 1" }, response: { verdict: "ok" } });

    const rows = listAudits(sid, 10);
    const byType = (t: string) => rows.find((r) => r.type === t)!;
    expect(byType("REVIEW")).toMatchObject({ procedure: null, grade: null, verdict: null });
    expect(rows.find((r) => r.type === "EXECUTE" && r.grade === "B")).toMatchObject({ procedure: "dbo.usp_Get", grade: "B", verdict: "READY" });
    expect(rows.find((r) => r.type === "EXECUTE_COMPARE")).toMatchObject({ procedure: "dbo.usp_Old", grade: "D", verdict: "OPTIMIZE" });
  });
});
