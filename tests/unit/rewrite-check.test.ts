import { describe, expect, it } from "vitest";
import { missingDeclarations, newWriteTargets, writeTargets } from "@/lib/rewrite-check";

const original = `CREATE PROCEDURE dbo.p AS
BEGIN
  CREATE TABLE #Staged (Id INT);
  INSERT INTO #Staged (Id) SELECT s.Id FROM dbo.SalesOrders AS s;
  UPDATE dbo.AuditLog SET Seen = 1; -- INSERT INTO dbo.Ignored in a comment
  SELECT 'DELETE FROM dbo.InString' AS t;
  DROP TABLE #Staged;
END`;

describe("rewrite write checks", () => {
  it("collects permanent write targets, ignoring temp tables, comments and strings", () => {
    expect([...writeTargets(original)]).toEqual(["auditlog"]);
  });

  it("flags writes the original never made", () => {
    const rewrite = original.replace("DROP TABLE #Staged;", "INSERT INTO [dbo].[SalesOrders] (Id) SELECT Id FROM cte;\n  TRUNCATE TABLE dbo.Customers;");
    expect(newWriteTargets(original, rewrite)).toEqual(["salesorders", "customers"]);
  });

  it("finds undeclared variables and temp tables the rewrite no longer creates", () => {
    const rewrite = `CREATE PROCEDURE dbo.p @StartDate DATETIME, @RegionID INT AS
BEGIN
  DECLARE @Local DATETIME = @StartDate, @Count INT;
  DECLARE @t TABLE (Id INT);
  INSERT INTO #Staged (Id) SELECT Id FROM dbo.SalesOrders WHERE OrderDate >= @Local AND RegionID = @Region;
  SELECT @@ROWCOUNT, @Count, 'mail@example.com';
  RAISERROR(@ErrorMessage, 16, 1);
END`;
    expect(missingDeclarations(original, rewrite)).toEqual(["@Region", "@ErrorMessage", "#Staged"]);
  });

  it("accepts a complete rewrite", () => {
    const rewrite = original.replace("CREATE PROCEDURE dbo.p AS", "CREATE PROCEDURE dbo.p @Id INT AS").replace("SELECT s.Id", "SELECT @Id");
    expect(missingDeclarations(original, rewrite)).toEqual([]);
  });

  it("allows a rewrite that keeps the same writes", () => {
    const rewrite = original.replace("UPDATE dbo.AuditLog SET Seen = 1;", "UPDATE AuditLog SET Seen = 1 WHERE Seen = 0;");
    expect(newWriteTargets(original, rewrite)).toEqual([]);
  });
});
