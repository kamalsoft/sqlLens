"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { sanitizeNext } from "@/components/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const next = sanitizeNext(
          new URLSearchParams(window.location.search).get("next")
        );
        router.replace(next);
        return;
      }

      let message = "Sign in failed";
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === "string") message = payload.error;
      } catch {
        // keep the generic message
      }
      setError(message);
      setPassword("");
    } catch {
      setError("Unable to reach the server");
    }
    setPending(false);
  }

  return (
    <main className="login-page" style={{ maxWidth: 380, margin: "12vh auto", padding: 24 }}>
      <h1>Sign in to SQLLens</h1>
      <form onSubmit={(event) => void handleSubmit(event)} className="form-grid">
        <div className="field full">
          <label className="label" htmlFor="login-username">Username</label>
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="field full">
          <label className="label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
            required
          />
        </div>

        {error && (
          <div className="field full" role="alert">
            {error}
          </div>
        )}

        <div className="field full">
          <button
            type="submit"
            className="button button-primary"
            disabled={pending || !username || !password}
          >
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
