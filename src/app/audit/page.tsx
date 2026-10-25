"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi } from "@/components/api-client";

type AuditItem = {
  id: string;
  type: string;
  createdAt: string;
  engine: string | null;
  simulated: boolean;
  status: string;
  recordNumber: number | null;
  hasShare: boolean;
};

export default function AuditListPage() {
  const api = useApi();
  const [audits, setAudits] = useState<AuditItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api<{ audits?: AuditItem[] }>("/api/audit", { cache: "no-store" }, "Unable to load audit history").then(
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
        <table aria-label="Audit history">
          <thead>
            <tr>
              <th>Record</th>
              <th>Type</th>
              <th>Created</th>
              <th>Engine</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {audits.map((audit) => (
              <tr key={audit.id}>
                <td>
                  <Link href={`/audit/${audit.id}`}>
                    #{audit.recordNumber ?? "-"}
                  </Link>
                </td>
                <td>{audit.type}</td>
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
      )}
    </main>
  );
}
