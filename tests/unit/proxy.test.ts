import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

const r = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(url, { method: init.method, headers: init.headers }));

afterEach(() => vi.unstubAllEnvs());

describe("proxy pages", () => {
  it("redirects to /login?next= without a cookie", () => {
    const res = r("http://localhost:3000/review?x=1");
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/review?x=1");
  });
  it("allows /login and cookie holders", () => {
    expect(r("http://localhost:3000/login").headers.get("location")).toBeNull();
    expect(
      r("http://localhost:3000/review", { headers: { cookie: "session_token=abc" } }).headers.get("location")
    ).toBeNull();
  });
});

describe("proxy api", () => {
  const post = (headers: Record<string, string>) =>
    r("http://localhost:3000/api/x", { method: "POST", headers });

  it("allows same-origin POST and no-origin non-browser POST", () => {
    expect(post({ host: "localhost:3000", origin: "http://localhost:3000" }).status).toBe(200);
    expect(post({ host: "127.0.0.1:3000" }).status).toBe(200);
    expect(post({ host: "[::1]:3000", "sec-fetch-site": "same-origin" }).status).toBe(200);
  });
  it("403 on cross-origin", async () => {
    const res = post({ host: "localhost:3000", origin: "http://evil.example" });
    expect(res.status).toBe(403);
  });
  it("403 on cross-site Sec-Fetch-Site without Origin", () => {
    expect(post({ host: "localhost:3000", "sec-fetch-site": "cross-site" }).status).toBe(403);
  });
  it("403 for unknown Host, even for GET; env allowlist extends", () => {
    const get = () => r("http://evil.example/api/x", { headers: { host: "evil.example" } });
    expect(get().status).toBe(403);
    vi.stubEnv("SQLLENS_ALLOWED_HOSTS", "lens.internal, other.test");
    expect(get().status).toBe(403);
    expect(r("http://lens.internal/api/x", { headers: { host: "lens.internal:8080" } }).status).toBe(200);
  });
  it("GET to allowed host passes", () => {
    expect(r("http://localhost:3000/api/x", { headers: { host: "localhost:3000" } }).status).toBe(200);
  });
});
