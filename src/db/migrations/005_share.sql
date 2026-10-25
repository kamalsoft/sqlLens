-- P4-06: share expiry and revocation. Legacy tokens keep NULL expiry and are treated as expired.
ALTER TABLE audit_requests ADD COLUMN share_expires_at TEXT;
ALTER TABLE audit_requests ADD COLUMN share_revoked INTEGER DEFAULT 0;
