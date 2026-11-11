"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApi } from "@/components/api-client";
import { filterAudits, NO_FILTER, type AuditFilter, type AuditListItem } from "@/lib/audit-filter";

const TYPES = ["EXECUTE", "EXECUTE_COMPARE", "COMPARE", "REVIEW"];
const VERDICTS = ["READY", "OPTIMIZE", "UNSTABLE", "INSUFFICIENT EVIDENCE"];
const GRADES = ["A", "B", "C", "D", "F"];

export default function AuditListPage() {
  const api = useApi();
  const [audits, setAudits] = useState<AuditListItem[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<AuditFilter>(NO_FILTER);

  useEffect(() => {
    let cancelled = false;
    void api<{ audits?: AuditListItem[] }>("/api/audit", { cache: "no-store" }, "Unable to load audit history").then(
      (res) => {
        if (cancelled) return;
        if (res.ok) setAudits(res.data?.audits ?? []);
        else if (res.status !== 401) setError(res.error ?? "Unable to load audit history");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const shown = useMemo(() => (audits ? filterAudits(audits, filter) : []), [audits, filter]);
  const set = (patch: Partial<AuditFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="page-kicker">History</p>
          <h2 className="page-title">Audit</h2>
        </div>
      </header>

      {error && <div role="alert">{error}</div>}
      {!error && audits === null && <p role="status">Loading audit history...</p>}
      {audits && audits.length === 0 && <p>No audit records yet.</p>}

      {audits && audits.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <input
              aria-label="Search audit records" placeholder="Search procedure, record, verdict"
              value={filter.query} onChange={(e) => set({ query: e.target.value })}
              style={{ flex: "1 1 220px", minHeight: 40, padding: "8px 10px" }}
            />
            <select aria-label="Filter by type" value={filter.type} onChange={(e) => set({ type: e.target.value })} style={{ minHeight: 40 }}>
              <option value="">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select aria-label="Filter by verdict" value={filter.verdict} onChange={(e) => set({ verdict: e.target.value })} style={{ minHeight: 40 }}>
              <option value="">All verdicts</option>
              {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select aria-label="Filter by grade" value={filter.grade} onChange={(e) => set({ grade: e.target.value })} style={{ minHeight: 40 }}>
              <option value="">All grades</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <p role="status" style={{ fontSize: 12, marginBottom: 8 }}>Showing {shown.length} of {audits.length}</p>

          {shown.length === 0 ? (
            <p>No records match these filters. Clear a filter to see more.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table aria-label="Audit history">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Type</th>
                    <th>Procedure</th>
                    <th>Grade</th>
                    <th>Verdict</th>
                    <th>Created</th>
                    <th>Engine</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((audit) => (
                    <tr key={audit.id}>
                      <td>
                        <Link href={`/audit/${audit.id}`}>#{audit.recordNumber ?? "-"}</Link>
                      </td>
                      <td>{audit.type}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{audit.procedure ?? "-"}</td>
                      <td>{audit.grade ?? "not graded"}</td>
                      <td>{audit.verdict ?? "-"}</td>
                      <td>{new Date(audit.createdAt).toLocaleString()}</td>
                      <td>{audit.engine ?? "-"}</td>
                      <td>{audit.status}</td>
                      <td>
                        {audit.simulated && <span className="badge">Simulated</span>}{" "}
                        {audit.hasShare && <span className="badge">Shared</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
