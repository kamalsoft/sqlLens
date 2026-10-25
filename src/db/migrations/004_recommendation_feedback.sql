-- P4-05: accept/reject/notes on recommendations. New table only.
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audit_requests(id),
  rec_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','rejected','pending')),
  note TEXT,
  user_id TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(audit_id, rec_key)
);
