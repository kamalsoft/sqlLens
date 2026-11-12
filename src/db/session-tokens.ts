import type Database from 'better-sqlite3';
import { createHash } from 'crypto';

/**
 * SEC-T6: sessions store SHA-256(token) (64 hex characters). Tokens saved in plain text before that are
 * hashed in place, so nobody is signed out and records tied to those sessions stay reachable.
 * Returns how many rows were converted.
 */
export function hashPlainSessionTokens(db: Database.Database): number {
  const plain = db.prepare('SELECT id, token FROM sessions WHERE length(token) <> 64').all() as { id: string; token: string }[];
  const update = db.prepare('UPDATE sessions SET token = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of plain) update.run(createHash('sha256').update(row.token).digest('hex'), row.id);
  })();
  return plain.length;
}
