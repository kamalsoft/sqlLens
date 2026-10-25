// Usage: npm run admin:set-password  (interactive) or `echo "<pw>" | npm run admin:set-password`
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
// Node strip-types needs explicit .ts extensions; tsconfig does not allow them (TS5097).
import { hashPassword } from "../src/lib/password.ts";
import { runMigrations } from "../src/db/migrate.ts";

const MIN_LEN = 12;

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
    process.stdout.write(prompt);
    rlAny._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readFirstLine(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return "";
}

async function main() {
  let password: string;
  if (process.stdin.isTTY) {
    password = await readHidden("New admin password: ");
    const again = await readHidden("Repeat password: ");
    if (password !== again) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  } else {
    password = await readFirstLine();
  }
  if (password.length < MIN_LEN) {
    console.error(`Password must be at least ${MIN_LEN} characters.`);
    process.exit(1);
  }

  const dbDir = process.env.SQLLENS_DB_DIR
    ? path.resolve(process.env.SQLLENS_DB_DIR)
    : path.resolve(process.cwd(), "../../sqllens_db");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new Database(path.join(dbDir, "sqllens.db"));
  runMigrations(db, path.join(process.cwd(), "src", "db", "migrations"));

  const hash = hashPassword(password);
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get("admin") as
    | { id: string }
    | undefined;
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, existing.id);
    // Password change invalidates existing sessions.
    db.prepare("UPDATE sessions SET is_active = 0 WHERE user_id = ?").run(existing.id);
  } else {
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(
      randomUUID(),
      "admin",
      hash
    );
  }
  db.close();
  console.log("Admin password set for user 'admin'.");
}

main().catch((err) => {
  console.error("Failed to set admin password:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
