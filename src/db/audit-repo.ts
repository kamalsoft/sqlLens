import { randomBytes, randomUUID } from "node:crypto";
import db from "./index";

export type AuditType = "EXECUTE" | "EXECUTE_COMPARE" | "COMPARE" | "REVIEW" | "REFACTOR";

export type InsertAuditInput = {
  sessionId: string;
  type: AuditType;
  request: unknown;
  response: unknown;
  engine?: string;
  simulated?: boolean;
  status?: "ok" | "error";
  elapsedMs?: number | null;
  logicalReads?: number | null;
  schemaVersion?: string;
  modelId?: string;
};

export type AuditSummary = {
  id: string;
  type: string;
  createdAt: string;
  engine: string | null;
  simulated: boolean;
  status: string;
  recordNumber: number | null;
  hasShare: boolean;
  shared: boolean;
  shareExpiresAt: string | null;
  elapsedMs: number | null;
  logicalReads: number | null;
  /** UX-4: procedure name from the request, or null for batches and reviews. */
  procedure?: string | null;
  /** RV-4: the database the run used (SQL Server), or null. */
  database?: string | null;
  /** UX-4: performance grade and prod-readiness verdict from the stored result, when present. */
  grade?: string | null;
  verdict?: string | null;
};

export type AuditRecord = AuditSummary & {
  request: unknown;
  response: unknown;
  schemaVersion: string | null;
  modelId: string | null;
};

type Row = {
  id: string;
  type: string;
  created_at: string;
  engine: string | null;
  simulated: number | null;
  status: string | null;
  record_number: number | null;
  shared_token: string | null;
  share_expires_at: string | null;
  share_revoked: number | null;
  elapsed_ms: number | null;
  logical_reads: number | null;
  procedure?: string | null;
  database?: string | null;
  grade?: string | null;
  verdict?: string | null;
};

function shareActive(r: Row, now = Date.now()): boolean {
  if (r.shared_token === null || r.share_revoked === 1) return false;
  const exp = r.share_expires_at ? Date.parse(r.share_expires_at) : NaN;
  return Number.isFinite(exp) && exp > now;
}

function summary(r: Row): AuditSummary {
  const active = shareActive(r);
  return {
    id: r.id,
    type: r.type,
    createdAt: r.created_at,
    engine: r.engine,
    simulated: r.simulated === 1,
    status: r.status ?? "ok",
    recordNumber: r.record_number,
    hasShare: active,
    shared: active,
    shareExpiresAt: active ? r.share_expires_at : null,
    elapsedMs: r.elapsed_ms,
    logicalReads: r.logical_reads,
    procedure: r.procedure ?? null,
    database: r.database ?? null,
    grade: r.grade ?? null,
    verdict: r.verdict ?? null,
  };
}

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const SUMMARY_COLS = "id, type, created_at, engine, simulated, status, record_number, shared_token, share_expires_at, share_revoked, elapsed_ms, logical_reads";

export function insertAudit(input: InsertAuditInput): { id: string; recordNumber: number } {
  const id = randomUUID();
  const tx = db.transaction((): number => {
    const max = db.prepare("SELECT MAX(record_number) AS m FROM audit_requests").get() as { m: number | null };
    const recordNumber = (max.m ?? 0) + 1;
    db.prepare(
      `INSERT INTO audit_requests
        (id, session_id, type, request_payload, response_payload, shared_token,
         engine, simulated, status, record_number, elapsed_ms, logical_reads, schema_version, model_id)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.sessionId,
      input.type,
      JSON.stringify(input.request ?? null),
      JSON.stringify(input.response ?? null),
      input.engine ?? null,
      input.simulated ? 1 : 0,
      input.status ?? "ok",
      recordNumber,
      input.elapsedMs ?? null,
      input.logicalReads ?? null,
      input.schemaVersion ?? null,
      input.modelId ?? null
    );
    return recordNumber;
  });
  return { id, recordNumber: tx.immediate() };
}

/** SEC-T4: deletes one of the session's own records with its feedback. False when it is not the session's. */
export function deleteAudit(id: string, sessionId: string): boolean {
  return db.transaction((): boolean => {
    const own = db.prepare("SELECT 1 FROM audit_requests WHERE id = ? AND session_id = ?").get(id, sessionId);
    if (!own) return false;
    db.prepare("DELETE FROM recommendation_feedback WHERE audit_id = ?").run(id);
    db.prepare("DELETE FROM audit_requests WHERE id = ?").run(id);
    return true;
  })();
}

/**
 * SEC-T4: deletes records older than `retentionDays` (with their feedback), then expired sessions
 * that no remaining record belongs to (records are owned by the session that made them).
 */
export function purgeExpired(retentionDays: number, now: Date = new Date()): { audits: number; sessions: number } {
  // created_at is SQLite's CURRENT_TIMESTAMP text (UTC, "YYYY-MM-DD HH:MM:SS"); expires_at is ISO.
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
  return db.transaction(() => {
    db.prepare(
      "DELETE FROM recommendation_feedback WHERE audit_id IN (SELECT id FROM audit_requests WHERE created_at < ?)"
    ).run(cutoff);
    const audits = db.prepare("DELETE FROM audit_requests WHERE created_at < ?").run(cutoff).changes;
    const sessions = db.prepare(
      `DELETE FROM sessions WHERE expires_at < ?
         AND NOT EXISTS (SELECT 1 FROM audit_requests a WHERE a.session_id = sessions.id)`
    ).run(now.toISOString()).changes;
    return { audits, sessions };
  })();
}

export function getAudit(id: string, sessionId: string): AuditRecord | null {
  const r = db
    .prepare(
      `SELECT ${SUMMARY_COLS}, request_payload, response_payload, schema_version, model_id
       FROM audit_requests WHERE id = ? AND session_id = ?`
    )
    .get(id, sessionId) as
    | (Row & {
        request_payload: string;
        response_payload: string | null;
        elapsed_ms: number | null;
        logical_reads: number | null;
        schema_version: string | null;
        model_id: string | null;
      })
    | undefined;
  if (!r) return null;
  return {
    ...summary(r),
    request: parse(r.request_payload),
    response: parse(r.response_payload),
    elapsedMs: r.elapsed_ms,
    logicalReads: r.logical_reads,
    schemaVersion: r.schema_version,
    modelId: r.model_id,
  };
}

/**
 * AD-2: records linked to this one: the run a refactor came from, and the refactors made from a run.
 * shortcut: the refactors lookup scans the session's REFACTOR rows with json_extract (no index); fine for a local
 * tool, add a generated column with an index if a session ever holds tens of thousands of records.
 */
export function relatedAudits(record: AuditRecord, sessionId: string): {
  source: { id: string; recordNumber: number | null } | null;
  refactors: { id: string; recordNumber: number | null }[];
} {
  const sourceId = (record.request as { sourceAuditId?: unknown } | null)?.sourceAuditId;
  const sourceRow = typeof sourceId === "string"
    ? (db.prepare("SELECT id, record_number FROM audit_requests WHERE id = ? AND session_id = ?").get(sourceId, sessionId) as
        { id: string; record_number: number | null } | undefined)
    : undefined;
  const refactors = db
    .prepare(
      `SELECT id, record_number FROM audit_requests
       WHERE session_id = ? AND type = 'REFACTOR' AND json_valid(request_payload)
         AND json_extract(request_payload, '$.sourceAuditId') = ?
       ORDER BY created_at, rowid`
    )
    .all(sessionId, record.id) as { id: string; record_number: number | null }[];
  return {
    source: sourceRow ? { id: sourceRow.id, recordNumber: sourceRow.record_number } : null,
    refactors: refactors.map((r) => ({ id: r.id, recordNumber: r.record_number })),
  };
}

export function listAudits(sessionId: string, limit = 100): AuditSummary[] {
  // UX-4: the procedure, grade and verdict are read inside SQLite, so the large plan payloads never leave the database.
  // A stored record that is not valid JSON gives NULL for these fields instead of failing the whole list.
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLS},
              CASE WHEN json_valid(request_payload) THEN json_extract(request_payload, '$.original.name') END AS procedure,
              CASE WHEN json_valid(request_payload) THEN json_extract(request_payload, '$.database') END AS database,
              CASE WHEN json_valid(response_payload) THEN COALESCE(json_extract(response_payload, '$.analysis.performanceGrade'),
                       json_extract(response_payload, '$.original.analysis.performanceGrade')) END AS grade,
              CASE WHEN json_valid(response_payload) THEN COALESCE(json_extract(response_payload, '$.analysis.prodVerdict.verdict'),
                       json_extract(response_payload, '$.original.analysis.prodVerdict.verdict')) END AS verdict
       FROM audit_requests WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(sessionId, Math.max(1, Math.min(limit, 500))) as Row[];
  return rows.map(summary);
}

export function auditStats(sessionId: string): {
  total: number;
  completed: number;
  averageElapsedMs: number;
  totalLogicalReads: number;
  recent: AuditSummary[];
} {
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS completed,
              AVG(CASE WHEN status = 'ok' THEN elapsed_ms END) AS avgElapsed,
              SUM(logical_reads) AS reads
       FROM audit_requests WHERE session_id = ? AND COALESCE(simulated, 0) = 0`
    )
    .get(sessionId) as { total: number; completed: number | null; avgElapsed: number | null; reads: number | null };
  const recent = db
    .prepare(
      `SELECT ${SUMMARY_COLS} FROM audit_requests
       WHERE session_id = ? AND COALESCE(simulated, 0) = 0
       ORDER BY created_at DESC, rowid DESC LIMIT 10`
    )
    .all(sessionId) as Row[];
  return {
    total: agg.total,
    completed: agg.completed ?? 0,
    averageElapsedMs: agg.avgElapsed === null ? 0 : Math.round(agg.avgElapsed),
    totalLogicalReads: agg.reads ?? 0,
    recent: recent.map(summary),
  };
}

export type FeedbackStatus = "accepted" | "rejected" | "pending";
export type FeedbackItem = { key: string; status: FeedbackStatus; note?: string };

export function getFeedback(
  auditId: string
): Record<string, { status: FeedbackStatus; note: string | null; updatedAt: string }> {
  const rows = db
    .prepare("SELECT rec_key, status, note, updated_at FROM recommendation_feedback WHERE audit_id = ?")
    .all(auditId) as { rec_key: string; status: FeedbackStatus; note: string | null; updated_at: string }[];
  const out: Record<string, { status: FeedbackStatus; note: string | null; updatedAt: string }> = {};
  for (const r of rows) out[r.rec_key] = { status: r.status, note: r.note, updatedAt: r.updated_at };
  return out;
}

/** Caller must have verified ownership of auditId. A missing note keeps the existing one. */
export function upsertFeedback(auditId: string, userId: string, items: FeedbackItem[]): void {
  const find = db.prepare("SELECT id, note FROM recommendation_feedback WHERE audit_id = ? AND rec_key = ?");
  const insert = db.prepare(
    "INSERT INTO recommendation_feedback (id, audit_id, rec_key, status, note, user_id) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const update = db.prepare(
    "UPDATE recommendation_feedback SET status = ?, note = ?, user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  db.transaction(() => {
    for (const it of items) {
      const row = find.get(auditId, it.key) as { id: string; note: string | null } | undefined;
      if (row) update.run(it.status, it.note ?? row.note, userId, row.id);
      else insert.run(randomUUID(), auditId, it.key, it.status, it.note ?? null, userId);
    }
  })();
}

/** Caller must have verified ownership. Replaces any previous token. */
export function createShare(id: string, ttlHours: number): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  db.prepare(
    "UPDATE audit_requests SET shared_token = ?, share_expires_at = ?, share_revoked = 0 WHERE id = ?"
  ).run(token, expiresAt, id);
  return { token, expiresAt };
}

export function revokeShare(id: string): void {
  db.prepare("UPDATE audit_requests SET share_revoked = 1 WHERE id = ?").run(id);
}

export type SharedLookup =
  | { state: "ok"; id: string; type: string; createdAt: string; result: unknown; expiresAt: string }
  | { state: "not_found" }
  | { state: "expired" };

export function lookupShare(token: string): SharedLookup {
  const r = db
    .prepare(
      `SELECT id, type, created_at, response_payload, share_expires_at, share_revoked
       FROM audit_requests WHERE shared_token = ?`
    )
    .get(token) as
    | {
        id: string;
        type: string;
        created_at: string;
        response_payload: string | null;
        share_expires_at: string | null;
        share_revoked: number | null;
      }
    | undefined;
  if (!r || r.share_revoked === 1) return { state: "not_found" };
  const exp = r.share_expires_at ? Date.parse(r.share_expires_at) : NaN;
  // NULL expiry = legacy auto-minted token: treated as expired.
  if (!Number.isFinite(exp) || exp <= Date.now()) return { state: "expired" };
  return {
    state: "ok",
    id: r.id,
    type: r.type,
    createdAt: r.created_at,
    result: parse(r.response_payload),
    expiresAt: r.share_expires_at as string,
  };
}
