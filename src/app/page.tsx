"use client";

import { useEffect, useState } from "react";

type Analysis = {
  id: string;
  procedureName: string;
  status: string;
  elapsedMs: number;
  logicalReads: number;
  createdAt: string;
};

type OverviewData = {
  totalAnalyses: number;
  completedAnalyses: number;
  averageElapsedMs: number;
  totalLogicalReads: number;
  recentAnalyses: Analysis[];
};

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadOverview() {
      try {
        const response = await fetch("/api/analysis", {
          cache: "no-store",
        });

        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? await response.json()
          : null;

        if (!response.ok) {
          throw new Error(
            payload?.error || `Unable to load overview (${response.status})`
          );
        }

        setData(payload);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load overview"
        );
      }
    }

    void loadOverview();
  }, []);

  return (
    <main className="overview-page">
      <header className="overview-header">
        <div>
          <span className="overview-eyebrow">Workspace</span>
          <h1>Overview</h1>
          <p>Monitor stored procedure analysis activity and performance.</p>
        </div>
      </header>

      {error ? (
        <div className="overview-alert">{error}</div>
      ) : !data ? (
        <div className="overview-empty">Loading overview...</div>
      ) : (
        <>
          <section className="overview-metrics" aria-label="Analysis metrics">
            <article className="overview-metric">
              <span>Total analyses</span>
              <strong>{data.totalAnalyses}</strong>
              <small>All submitted analyses</small>
            </article>

            <article className="overview-metric">
              <span>Completed</span>
              <strong>{data.completedAnalyses}</strong>
              <small>Successfully completed</small>
            </article>

            <article className="overview-metric">
              <span>Average elapsed time</span>
              <strong>{data.averageElapsedMs} ms</strong>
              <small>Across completed analyses</small>
            </article>

            <article className="overview-metric">
              <span>Logical reads</span>
              <strong>{data.totalLogicalReads.toLocaleString()}</strong>
              <small>Total captured reads</small>
            </article>
          </section>

          <section className="overview-section">
            <div className="overview-section-heading">
              <div>
                <span className="overview-eyebrow">Activity</span>
                <h2>Recent analyses</h2>
              </div>
              <span className="overview-count">
                {data.recentAnalyses.length} records
              </span>
            </div>

            {data.recentAnalyses.length === 0 ? (
              <div className="overview-empty">
                <strong>No analyses yet</strong>
                <p>
                  Run a stored procedure review to see results here.
                </p>
              </div>
            ) : (
              <div className="overview-table-wrapper">
                <table className="overview-table">
                  <thead>
                    <tr>
                      <th>Procedure</th>
                      <th>Status</th>
                      <th>Elapsed time</th>
                      <th>Logical reads</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentAnalyses.map((analysis) => (
                      <tr key={analysis.id}>
                        <td>{analysis.procedureName}</td>
                        <td>
                          <span
                            className={`analysis-status ${analysis.status}`}
                          >
                            {analysis.status}
                          </span>
                        </td>
                        <td>{analysis.elapsedMs} ms</td>
                        <td>{analysis.logicalReads.toLocaleString()}</td>
                        <td>
                          {new Date(analysis.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
