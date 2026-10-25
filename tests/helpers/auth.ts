import { randomUUID } from "node:crypto";
import db from "@/db";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export const TEST_ADMIN = { username: "admin", password: "correct-horse-battery" };

export function seedAdmin(): string {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(TEST_ADMIN.username) as
    | { id: string }
    | undefined;
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(TEST_ADMIN.password),
      existing.id
    );
    return existing.id;
  }
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(
    id,
    TEST_ADMIN.username,
    hashPassword(TEST_ADMIN.password)
  );
  return id;
}

/** Seeds an admin in the temp DB and returns a Cookie header value for a fresh session. */
export function createTestSession(): string {
  const userId = seedAdmin();
  const { token } = createSession(userId);
  return `session_token=${token}`;
}
