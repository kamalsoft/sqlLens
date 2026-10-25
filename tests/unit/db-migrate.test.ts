import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';

const REAL_DIR = path.resolve(__dirname, '../../src/db/migrations');
const OLD_SQL = fs.readFileSync(path.join(REAL_DIR, '001_baseline.sql'), 'utf8');
// Every real migration, in order; new migrations must not break these tests.
const ALL_REAL = fs.readdirSync(REAL_DIR).filter((f) => f.endsWith('.sql')).sort();

let tmp: string;
let db: Database.Database;

const tables = () =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqllens-mig-'));
  db = new Database(path.join(tmp, 'test.db'));
});
afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function migDir(files: Record<string, string>) {
  const dir = path.join(tmp, 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
  return dir;
}

describe('runMigrations', () => {
  it('creates all tables on a fresh DB and is idempotent', () => {
    expect(runMigrations(db, REAL_DIR)).toEqual(ALL_REAL);
    expect(tables()).toEqual(
      expect.arrayContaining(['users', 'sessions', 'app_config', 'audit_requests', 'schema_migrations'])
    );
    expect(runMigrations(db, REAL_DIR)).toEqual([]);
  });

  it('applies baseline over existing tables without data loss', () => {
    db.exec(OLD_SQL.replace(/IF NOT EXISTS /g, ''));
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run('u1', 'admin', 'h');
    expect(runMigrations(db, REAL_DIR)).toEqual(ALL_REAL);
    expect(db.prepare('SELECT username FROM users WHERE id = ?').get('u1')).toEqual({ username: 'admin' });
  });

  it('rejects bad file names', () => {
    const dir = migDir({ 'bad-name.sql': 'SELECT 1;' });
    expect(() => runMigrations(db, dir)).toThrow(/bad-name\.sql/);
  });

  it('rolls back a failing migration and names the file', () => {
    const dir = migDir({
      '001_ok.sql': 'CREATE TABLE a (x INTEGER);',
      '002_fail.sql': 'CREATE TABLE b (x INTEGER); INSERT INTO nope VALUES (1);',
    });
    expect(() => runMigrations(db, dir)).toThrow(/002_fail\.sql/);
    expect(tables()).toContain('a');
    expect(tables()).not.toContain('b');
    expect(db.prepare('SELECT id FROM schema_migrations').all()).toEqual([{ id: '001_ok.sql' }]);
  });

  it('applies in numeric order', () => {
    const dir = migDir({ '010_b.sql': 'CREATE TABLE b (x);', '002_a.sql': 'CREATE TABLE a (x);' });
    expect(runMigrations(db, dir)).toEqual(['002_a.sql', '010_b.sql']);
  });

  it('rejects duplicate numeric prefixes', () => {
    const dir = migDir({ '002_a.sql': 'CREATE TABLE a (x);', '002_b.sql': 'CREATE TABLE b (x);' });
    expect(() => runMigrations(db, dir)).toThrow(/Duplicate migration number 002/);
  });

  it('is safe across two connections opened before either migrates', () => {
    const dir = migDir({ '001_a.sql': 'CREATE TABLE a (x);', '002_b.sql': 'CREATE TABLE b (x);' });
    const file = path.join(tmp, 'test.db');
    const db2 = new Database(file);
    try {
      const r1 = runMigrations(db, dir);
      const r2 = runMigrations(db2, dir);
      expect(r1.length + r2.length).toBe(2);
      expect(r2).toEqual([]);
    } finally {
      db2.close();
    }
  });
});
