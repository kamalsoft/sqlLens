import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

/**
 * Applies pending numbered .sql migrations from migrationsDir.
 * Each runs in its own transaction; returns the IDs applied (file names).
 */
export function runMigrations(db: Database.Database, migrationsDir: string): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const files = fs.readdirSync(migrationsDir).filter((f) => !f.startsWith('.'));
  for (const file of files) {
    if (!MIGRATION_NAME.test(file)) {
      throw new Error(`Invalid migration file name: ${file}`);
    }
  }
  files.sort((a, b) => parseInt(a.slice(0, 3), 10) - parseInt(b.slice(0, 3), 10) || a.localeCompare(b));

  const seen = new Map<string, string>();
  for (const file of files) {
    const prefix = file.slice(0, 3);
    const other = seen.get(prefix);
    if (other) {
      throw new Error(`Duplicate migration number ${prefix}: ${other} and ${file}`);
    }
    seen.set(prefix, file);
  }

  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');
  const record = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');
  const done: string[] = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
      // IMMEDIATE takes the write lock up front; re-check inside so a
      // concurrent process that applied this file first makes us skip it.
      const ran = db.transaction((): boolean => {
        if (isApplied.get(file)) return false;
        db.exec(sql);
        record.run(file);
        return true;
      }).immediate();
      if (ran) done.push(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration failed: ${file}: ${msg}`);
    }
  }
  return done;
}
