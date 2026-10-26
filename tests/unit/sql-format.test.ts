import { describe, expect, it } from "vitest";
import { formatTsql } from "@/lib/sql-format";

describe("formatTsql", () => {
  it("lays out a procedure: parameters, blocks, TRY/CATCH, transactions, hints", () => {
    const sql = `CREATE PROCEDURE dbo.p @A INT, @B DATETIME AS BEGIN SET NOCOUNT ON; BEGIN TRY BEGIN TRANSACTION;
SELECT a.Id FROM dbo.T AS a WITH (NOLOCK) WHERE a.Id = @A; COMMIT TRANSACTION; END TRY BEGIN CATCH IF @@TRANCOUNT > 0 BEGIN ROLLBACK TRANSACTION; END THROW; END CATCH END`;
    const { text, formatted } = formatTsql(sql);
    expect(formatted).toBe(true);
    expect(text).toBe(`CREATE PROCEDURE dbo.p
    @A INT,
    @B DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT
            a.Id
        FROM
            dbo.T AS a WITH (NOLOCK)
        WHERE
            a.Id = @A;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
        BEGIN
            ROLLBACK TRANSACTION;
        END
        THROW;
    END CATCH
END`);
  });

  it("never changes strings, comments or CASE expressions", () => {
    const sql = "SELECT CASE WHEN a = 1 THEN 'x  END  begin' ELSE 'z' END AS k FROM dbo.t; -- keep   END   spacing";
    const { text, formatted } = formatTsql(sql);
    expect(formatted).toBe(true);
    expect(text).toContain("'x  END  begin'");
    expect(text).toContain("-- keep   END   spacing");
    expect(text).toMatch(/CASE\n\s+WHEN a = 1 THEN 'x  END  begin'\n\s+ELSE 'z'\n\s+END AS k/);
  });

  it("keeps GO batch separators", () => {
    const { text } = formatTsql("SET ANSI_NULLS ON;\nGO\nSELECT 1;\nGO");
    expect(text).toBe("SET ANSI_NULLS ON;\nGO\n\nSELECT\n    1;\nGO");
  });

  it("is stable when run twice", () => {
    const once = formatTsql("CREATE PROCEDURE dbo.p AS BEGIN SELECT 1; END").text;
    expect(formatTsql(once).text).toBe(once);
  });

  it("returns empty input unformatted", () => {
    expect(formatTsql("   ")).toEqual({ text: "", formatted: false });
  });
});
