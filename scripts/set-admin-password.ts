// Usage: npm run admin:set-password  (interactive) or `echo "<pw>" | npm run admin:set-password`
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
// Node strip-types needs explicit .ts extensions; tsconfig does not allow them (TS5097).
import { hashPassword } from "../src/lib/password.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { MIN_PASSWORD_LENGTH, applyKeys, mismatchProblem, passwordProblem } from "../src/lib/admin-password.ts";

const MAX_ATTEMPTS = 3;

/** Reads one line with each typed character shown as `*`. Ctrl+C cancels. */
function readMasked(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = "";
    const onData = (chunk: string) => {
      const result = applyKeys(value, chunk);
      value = result.value;
      if (result.echo) process.stdout.write(result.echo);
      if (result.done) {
        input.removeListener("data", onData);
        input.setRawMode(false);
        input.pause();
        process.stdout.write("\n");
        if (result.cancelled) reject(new Error("Cancelled. No password was changed."));
        else resolve(value);
      }
    };
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
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

/** Asks for the new password twice. Each rejected entry counts as an attempt. */
async function promptNewPassword(): Promise<string> {
  console.log(`Set the admin password. It must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  console.log("Type it, then type it again. Each character shows as *. Press Ctrl+C to cancel.");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const first = await readMasked("New admin password: ");
    const problem = passwordProblem(first);
    if (problem) {
      console.error(`${problem} (attempt ${attempt} of ${MAX_ATTEMPTS})`);
      continue;
    }
    const repeat = await readMasked("Type it again:     ");
    const mismatch = mismatchProblem(first, repeat);
    if (mismatch) {
      console.error(`${mismatch} Start again. (attempt ${attempt} of ${MAX_ATTEMPTS})`);
      continue;
    }
    return first;
  }
  throw new Error("Too many attempts. No password was changed.");
}

async function main() {
  let password: string;
  if (process.stdin.isTTY) {
    password = await promptNewPassword();
  } else {
    password = await readFirstLine();
    const problem = passwordProblem(password);
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
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
  console.log(
    existing
      ? "Admin password updated. Existing sessions were signed out."
      : "Admin account created with the new password."
  );
}

main().catch((err) => {
  console.error("Failed to set admin password:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
