import { NextResponse } from "next/server";

export async function GET() {
  // Replace this query with the repository's existing analysis store/query.
  const analyses: Array<{
    id: string;
    procedureName: string;
    status: string;
    elapsedMs: number;
    logicalReads: number;
    createdAt: string;
  }> = [];

  const completed = analyses.filter(
    (analysis) => analysis.status === "completed"
  );

  return NextResponse.json(
    {
      totalAnalyses: analyses.length,
      completedAnalyses: completed.length,
      averageElapsedMs: completed.length
        ? Math.round(
            completed.reduce(
              (total, analysis) => total + analysis.elapsedMs,
              0
            ) / completed.length
          )
        : 0,
      totalLogicalReads: analyses.reduce(
        (total, analysis) => total + analysis.logicalReads,
        0
      ),
      recentAnalyses: analyses.slice(0, 10),
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function POST() {
  const res = await fetch("/api/analysis", { method: "POST" });
  const data = await res.json();
  console.log(data);
  return NextResponse.json({
    summary: "Static demo response",
    status: "mock",
    tables: [
      { name: "SalesOrderHeader", reads: 1200, cost: "medium" },
      { name: "SalesOrderDetail", reads: 950, cost: "low" },
    ],
    recommendations: [
      "Add an index on the filter key",
      "Avoid scan-heavy predicates",
      "Review parameter sniffing"
    ]
  });
}