import { describe, expect, it } from "vitest";
import { looksLikeSql, validateSqlInput } from "@/lib/validation/sql-input";
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

describe("looksLikeSql", () => {
  it.each([
    "SELECT 1",
    "CREATE PROCEDURE dbo.p @Id INT AS BEGIN SET NOCOUNT ON; SELECT * FROM t WHERE id = @Id; END",
    "-- header comment\n/* block */\nALTER PROC dbo.p AS SELECT 1",
    "SET ANSI_NULLS ON\nGO\nCREATE PROCEDURE dbo.p AS SELECT 1",
    "WITH c AS (SELECT 1 AS x) SELECT x FROM c",
    "EXEC dbo.p @a = 1",
    "```sql\nSELECT name FROM sys.tables;\n```",
    "update t set a = 1 where id = 2",
    "CREATE OR ALTER PROCEDURE dbo.p AS SELECT 1",
    "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql",
    "DECLARE @x INT = 1;",
    "INSERT INTO dbo.t (a) VALUES (1)",
    "BEGIN TRAN; DELETE FROM t; COMMIT",
    "SET NOCOUNT ON;",
    "SELECT a",
    "SELECT name, id FROM t",
  ])("accepts %j", (sql) => {
    expect(looksLikeSql(sql)).toBe(true);
  });

  it.each([
    "hello, can you review my code?",
    "Set the table for dinner please",
    '{"summary": "not sql"}',
    "def main():\n    print('hi')",
    "function f() { return 1; }",
    "-- only a comment",
    "Select the best option for me",
    "'SELECT 1 FROM t;'",
    "Create a report on last month's sales",
    "Update me when the review is done",
    "Delete this file now please",
    "With love from the team",
    "Execute the plan tomorrow morning",
    "If you can, please help",
  ])("rejects %j", (text) => {
    expect(looksLikeSql(text)).toBe(false);
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
