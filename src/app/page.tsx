"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../components/AppShell";

const metricCards = [
  { label: "Active SPs", value: "128", delta: "+12.4%", tone: "blue" },
  { label: "Avg. latency", value: "118ms", delta: "-8.3%", tone: "green" },
  { label: "Index gaps", value: "09", delta: "+2", tone: "amber" },
  { label: "Risk score", value: "26/100", delta: "-6.1%", tone: "red" },
];

const recentRuns = [
  { name: "usp_LoadCustomerOrders", status: "Healthy", duration: "1.2s", model: "gpt-4o-mini" },
  { name: "usp_RebuildInventory", status: "Warning", duration: "2.8s", model: "phi-3-mini" },
  { name: "usp_InvoiceSummary", status: "Critical", duration: "4.4s", model: "mistral-7b" },
];

const recommendations = [
  "Add nonclustered index on OrderId filter path",
  "Replace repeated scalar subqueries with a temp aggregate",
  "Reduce table scans in usp_InvoiceSummary by narrowing date predicate",
];

export default function HomePage() {
  const [isRunning, setIsRunning] = useState(false);
  const [analysis, setAnalysis] = useState<{
    result: string;
    summary: string;
    score: number;
    tables: string[];
    nextAction: string;
  } | null>(null);

  const lastUpdated = useMemo(() => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), []);

  const runAnalysis = () => {
    setIsRunning(true);

    window.setTimeout(() => {
      setAnalysis({
        result: "Passed with warnings",
        summary: "The stored procedure shows no blocking issues, but there are 3 scan-heavy hotspots and 1 missing index candidate.",
        score: 74,
        tables: ["SalesOrderHeader", "SalesOrderDetail", "Customer", "InvoiceHeader"],
        nextAction: "Prioritize the missing index on OrderId before the next release window.",
      });
      setIsRunning(false);
    }, 700);
  };

  return (
    <AppShell>
      <div className="dashboard-page">
        <header className="page-header">
          <div>
            <p className="page-kicker">Overview</p>
            <h1 className="page-title">SQL Performance Command Center</h1>
          </div>

          <div className="page-actions">
            <Link href="/settings" className="button button-secondary">
              Settings
            </Link>
            <button type="button" className="button button-primary" onClick={runAnalysis} disabled={isRunning}>
              {isRunning ? "Running analysis..." : "Analysis SP"}
            </button>
          </div>
        </header>

        <section className="stats-grid">
          {metricCards.map((card) => (
            <article key={card.label} className={`metric-card tone-${card.tone}`}>
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
              <div className="metric-delta">{card.delta}</div>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <div className="panel panel-card wide-panel">
            <div className="section-title-row">
              <div>
                <p className="page-kicker">Latest run</p>
                <h2 className="section-title">Execution Summary</h2>
              </div>
              <span className="muted-tag">Updated {lastUpdated}</span>
            </div>

            {analysis ? (
              <div className="analysis-panel">
                <div className="analysis-header">
                  <span className="status-pill success">{analysis.result}</span>
                  <span className="score-pill">Score: {analysis.score}/100</span>
                </div>

                <p className="analysis-summary">{analysis.summary}</p>

                <div className="analysis-columns">
                  <div>
                    <h3>Tables scanned</h3>
                    <ul className="simple-list">
                      {analysis.tables.map((table) => (
                        <li key={table}>{table}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3>Recommended next action</h3>
                    <p className="analysis-note">{analysis.nextAction}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <p>No analysis run yet.</p>
                <span>Use “Analysis SP” to generate a mock review result.</span>
              </div>
            )}
          </div>

          <div className="panel panel-card">
            <div className="section-title-row">
              <div>
                <p className="page-kicker">Insights</p>
                <h2 className="section-title">Recommendations</h2>
              </div>
            </div>

            <ul className="recommendations-list">
              {recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="panel panel-card">
          <div className="section-title-row">
            <div>
              <p className="page-kicker">Recent activity</p>
              <h2 className="section-title">Stored Procedure Runs</h2>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Procedure</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>
                      <span className={`status-pill ${row.status === "Healthy" ? "success" : row.status === "Warning" ? "warning" : "danger"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>{row.duration}</td>
                    <td>{row.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
