/** UX-4: the audit list item, and the search and filters the list applies on the client. */
export type AuditListItem = {
  id: string;
  type: string;
  createdAt: string;
  engine: string | null;
  simulated: boolean;
  status: string;
  recordNumber: number | null;
  hasShare: boolean;
  procedure?: string | null;
  grade?: string | null;
  verdict?: string | null;
};

export type AuditFilter = { query: string; type: string; verdict: string; grade: string };

export const NO_FILTER: AuditFilter = { query: '', type: '', verdict: '', grade: '' };

/** Filters the list. An empty filter field matches everything. */
export function filterAudits(items: AuditListItem[], f: AuditFilter): AuditListItem[] {
  const q = f.query.trim().toLowerCase();
  return items.filter((a) => {
    if (f.type && a.type !== f.type) return false;
    if (f.verdict && a.verdict !== f.verdict) return false;
    if (f.grade && (a.grade ?? '') !== f.grade) return false;
    if (!q) return true;
    const haystack = [a.procedure, a.type, a.engine, a.verdict, a.grade, a.recordNumber === null ? null : String(a.recordNumber)]
      .filter((x): x is string => typeof x === 'string')
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}
