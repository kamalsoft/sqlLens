import { describe, expect, it } from "vitest";
import { validateSqlInput } from "@/lib/validation/sql-input";
import { isBoolean, isNumber, isString, readJson } from "@/lib/validation/body";

describe("validateSqlInput", () => {
  it.each([
    [123, false],
    ["", false],
    ["   \n", false],
    ["a\0b", false],
    ["x".repeat(11), false],
    ["SELECT 1", true],
    ["x".repeat(10), true],
  ])("%j -> ok=%s", (value, ok) => {
    expect(validateSqlInput(value, 10).ok).toBe(ok);
  });
  it("returns the SQL unchanged", () => {
    expect(validateSqlInput("  SELECT 1 ", 100)).toEqual({ ok: true, sql: "  SELECT 1 " });
  });
});

describe("body helpers", () => {
  it("guards", () => {
    expect(isString("a") && isNumber(1) && isBoolean(false)).toBe(true);
    expect(isNumber(NaN)).toBe(false);
  });
  it("readJson rejects bad bodies with 400", async () => {
    const bad = await readJson(new Request("http://localhost/", { method: "POST", body: "{" }));
    expect(bad.ok).toBe(false);
    const arr = await readJson(new Request("http://localhost/", { method: "POST", body: "[1]" }));
    expect(arr.ok).toBe(false);
    const good = await readJson(new Request("http://localhost/", { method: "POST", body: '{"a":1}' }));
    expect(good).toEqual({ ok: true, body: { a: 1 } });
  });
});
