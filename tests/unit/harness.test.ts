import path from "node:path";
import { describe, expect, it } from "vitest";

describe("test harness isolation", () => {
  it("points the database and audit logs at temp directories", () => {
    const repoDb = path.resolve(process.cwd(), "../../sqllens_db");
    expect(process.env.SQLLENS_DB_DIR).toBeTruthy();
    expect(path.resolve(process.env.SQLLENS_DB_DIR!)).not.toBe(repoDb);
    expect(process.env.SQLLENS_AUDIT_LOG_DIR).toContain("sqllens-test-audit-");
  });

  it("stubs server-only so server modules can be imported", async () => {
    await expect(import("@/lib/app-config")).resolves.toHaveProperty("readAppConfig");
  });
});
