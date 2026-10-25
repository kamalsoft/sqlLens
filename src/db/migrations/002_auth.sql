-- P6-01: session expiry + retire insecure legacy auth state. Additive; no rows deleted.
ALTER TABLE sessions ADD COLUMN expires_at TEXT;
UPDATE sessions SET is_active = 0;
UPDATE users SET password_hash = '!disabled' WHERE password_hash NOT LIKE 'scrypt$%';
