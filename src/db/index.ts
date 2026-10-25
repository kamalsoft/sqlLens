import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrate';

// Store the database outside the app as per R008
// We'll create it two levels up from the project root, or in a specific absolute path.
// Override with SQLLENS_DB_DIR (D-022).
const dbDir = process.env.SQLLENS_DB_DIR
  ? path.resolve(process.env.SQLLENS_DB_DIR)
  : path.resolve(process.cwd(), '../../sqllens_db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'sqllens.db');
const db = new Database(dbPath);

// Apply versioned SQL migrations (src/db/migrations)
runMigrations(db, path.join(process.cwd(), 'src', 'db', 'migrations'));

export default db;
