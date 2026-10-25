import { NextResponse } from "next/server";
import db from "@/db";
import { createSession, setSessionCookie } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { loginAllowed } from "@/lib/request-guard";
import { isString, readJson } from "@/lib/validation/body";
import { logError } from "@/lib/redact";

// Used to keep timing similar when the user does not exist.
const DUMMY_HASH = hashPassword("sqllens-dummy-password");
const INVALID = { error: "Invalid username or password" };

export async function POST(request: Request) {
  try {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const { username, password } = parsed.body;
    if (!loginAllowed(request, username)) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
    if (!isString(username) || !isString(password) || username.length > 256 || password.length > 1024) {
      return NextResponse.json(INVALID, { status: 401 });
    }

    const user = db
      .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
      .get(username) as { id: string; username: string; password_hash: string } | undefined;

    // Legacy/disabled hashes are verified against the dummy hash to keep timing uniform.
    const usable = user !== undefined && user.password_hash.startsWith("scrypt$");
    const valid = verifyPassword(password, usable ? user.password_hash : DUMMY_HASH);
    if (!user || !usable || !valid) return NextResponse.json(INVALID, { status: 401 });

    const { token, expiresAt } = createSession(user.id);
    const response = NextResponse.json({ success: true, user: { id: user.id, username: user.username } });
    setSessionCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    logError("[auth/login]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
