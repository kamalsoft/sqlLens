-- P2-06: execution metadata on audit_requests. Additive; existing rows kept.
-- shared_token is already nullable (TEXT UNIQUE) in 001; no table rebuild needed.
ALTER TABLE audit_requests ADD COLUMN engine TEXT;
ALTER TABLE audit_requests ADD COLUMN simulated INTEGER DEFAULT 0;
ALTER TABLE audit_requests ADD COLUMN status TEXT DEFAULT 'ok';
ALTER TABLE audit_requests ADD COLUMN record_number INTEGER;
ALTER TABLE audit_requests ADD COLUMN elapsed_ms REAL;
ALTER TABLE audit_requests ADD COLUMN logical_reads INTEGER;
ALTER TABLE audit_requests ADD COLUMN schema_version TEXT;
ALTER TABLE audit_requests ADD COLUMN model_id TEXT;

UPDATE audit_requests SET record_number = (
  SELECT COUNT(*) FROM audit_requests b
  WHERE b.created_at < audit_requests.created_at
     OR (b.created_at = audit_requests.created_at AND b.rowid <= audit_requests.rowid)
);
