import { NextResponse } from "next/server";

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