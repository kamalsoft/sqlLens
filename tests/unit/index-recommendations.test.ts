import { describe, expect, it } from "vitest";
import { buildCreateIndex, verifyIndexRecommendations } from "@/lib/index-recommendations";
import type { IndexRecommendation } from "@/lib/review-schema";

const sql = `CREATE OR ALTER PROCEDURE dbo.usp_Summary @StartDate DATETIME, @RegionID INT AS
BEGIN
  WITH FilteredSales AS (
    SELECT s.CustomerID, s.TotalAmount FROM dbo.SalesOrders AS s
    WHERE s.OrderDate >= @StartDate AND s.RegionID = @RegionID
  )
  SELECT c.CustomerName, SUM(fs.TotalAmount) FROM [dbo].[Customers] c
  INNER JOIN FilteredSales fs ON c.CustomerID = fs.CustomerID
  GROUP BY c.CustomerName;
  SELECT * INTO #tmp FROM dbo.Customers;
END`;

const rec = (table: string, keyColumns: string[], includeColumns: string[] = []): IndexRecommendation => ({
  table,
  keyColumns,
  includeColumns,
  reason: "r",
  evidence: "e",
});

describe("verifyIndexRecommendations", () => {
  it("keeps real tables whose columns appear in the SQL and generates the DDL", () => {
    const { kept, removed } = verifyIndexRecommendations(
      [rec("dbo.SalesOrders", ["RegionID", "OrderDate"], ["CustomerID", "TotalAmount", "RegionID"]), rec("Customers", ["CustomerID"])],
      sql,
    );
    expect(removed).toBe(0);
    expect(kept[0].includeColumns).toEqual(["CustomerID", "TotalAmount"]);
    expect(kept[0].createStatement).toBe(
      "CREATE NONCLUSTERED INDEX [IX_SalesOrders_RegionID_OrderDate] ON [dbo].[SalesOrders] ([RegionID], [OrderDate]) INCLUDE ([CustomerID], [TotalAmount]);",
    );
    expect(kept[1].createStatement).toBe("CREATE NONCLUSTERED INDEX [IX_Customers_CustomerID] ON [Customers] ([CustomerID]);");
  });

  it.each([
    ["an alias", rec("s", ["RegionID"])],
    ["a CTE", rec("FilteredSales", ["CustomerID"])],
    ["a temp table", rec("#tmp", ["CustomerID"])],
    ["an invented table", rec("dbo.Invoices", ["CustomerID"])],
    ["an invented column", rec("dbo.SalesOrders", ["ShipDate"])],
    ["no key columns", rec("dbo.SalesOrders", [])],
    ["an unsafe identifier", rec("dbo.SalesOrders; DROP TABLE x", ["RegionID"])],
    ["an unsafe column", rec("dbo.SalesOrders", ["RegionID]) ; DROP TABLE x --"])],
  ])("drops %s", (_name, item) => {
    expect(verifyIndexRecommendations([item], sql)).toEqual({ kept: [], removed: 1 });
  });

  it("accepts unqualified columns of a single-table query", () => {
    const single = "SELECT Id, Total FROM dbo.Orders WHERE CustomerId = @CustomerId ORDER BY Total";
    expect(verifyIndexRecommendations([rec("dbo.Orders", ["CustomerId"], ["Id", "Total"])], single).removed).toBe(0);
  });

  it("drops computed aliases and columns qualified by another table", () => {
    const proc = `WITH Tier AS (
      SELECT c.CustomerID, RANK() OVER (ORDER BY SUM(s.TotalAmount) DESC) AS TopRank
      FROM dbo.Customers AS c JOIN dbo.SalesOrders AS s WITH (NOLOCK) ON s.CustomerID = c.CustomerID
      GROUP BY c.CustomerID, c.Segment
    ) SELECT t.TopRank FROM Tier t`;
    // TopRank is a computed alias; Segment belongs to Customers (c.), not SalesOrders.
    expect(verifyIndexRecommendations([rec("dbo.SalesOrders", ["CustomerID", "TopRank"])], proc).removed).toBe(1);
    expect(verifyIndexRecommendations([rec("dbo.SalesOrders", ["Segment"])], proc).removed).toBe(1);
    expect(verifyIndexRecommendations([rec("dbo.SalesOrders", ["CustomerID"], ["TotalAmount"])], proc).removed).toBe(0);
  });

  it("ignores names that appear only in comments", () => {
    const commented = "SELECT o.Id FROM dbo.Orders o -- consider o.ShipDate later";
    expect(verifyIndexRecommendations([rec("dbo.Orders", ["ShipDate"])], commented).removed).toBe(1);
  });

  it("escapes closing brackets in identifiers", () => {
    expect(buildCreateIndex("[a]]b]", ["c"], [])).toBe("CREATE NONCLUSTERED INDEX [IX_a]]b_c] ON [a]]b] ([c]);");
  });
});
