import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), "sqllens-cfg-")), "appconfig.json");
process.env.SQLLENS_CONFIG_PATH = cfgPath;

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as getConfig, PUT as putConfig } from "@/app/api/appconfig/route";
import { GET as audit } from "@/app/api/audit/route";
import { GET as analysis } from "@/app/api/analysis/route";
import { POST as compare } from "@/app/api/compare/route";
import { GET as share } from "@/app/api/share/[token]/route";
import { resetRateLimits } from "@/lib/request-guard";
import { createTestSession, seedAdmin, TEST_ADMIN } from "../helpers/auth";

const post = (url: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const put = (body: unknown, cookie?: string) =>
  new Request("http://localhost/api/appconfig", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const get = (url: string, cookie?: string) =>
  new Request(`http://localhost${url}`, { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  resetRateLimits();
  seedAdmin();
});

describe("auth routes", () => {
  it("login ok sets an httpOnly cookie", async () => {
    const res = await login(post("/api/auth/login", TEST_ADMIN));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const cookie = setCookie.split(";")[0];
    expect(await (await me(get("/api/auth/me", cookie))).json()).toMatchObject({
      authenticated: true,
      user: { username: "admin" },
    });
    const out = await logout(post("/api/auth/logout", {}, cookie));
    expect(out.status).toBe(200);
    expect(await (await me(get("/api/auth/me", cookie))).json()).toEqual({ authenticated: false });
  });
  it("wrong password and unknown user both 401 with the same body, and no user is created", async () => {
    const a = await login(post("/api/auth/login", { username: "admin", password: "nope" }));
    const b = await login(post("/api/auth/login", { username: "ghost", password: "nope" }));
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual({ error: "Invalid username or password" });
    expect(await b.json()).toEqual({ error: "Invalid username or password" });
    const { default: db } = await import("@/db");
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'ghost'").get()).toBeUndefined();
  });
  it("rate limits login after 5 attempts", async () => {
    const bad = { username: "admin", password: "nope" };
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", bad))).status).toBe(401);
    expect((await login(post("/api/auth/login", TEST_ADMIN))).status).toBe(429);
  });
  it("legacy hash users get 401", async () => {
    const { default: db } = await import("@/db");
    db.prepare("INSERT OR REPLACE INTO users (id, username, password_hash) VALUES ('legacy','legacy','!disabled')").run();
    const res = await login(post("/api/auth/login", { username: "legacy", password: "!disabled" }));
    expect(res.status).toBe(401);
  });
  it("me is unauthenticated without a cookie", async () => {
    expect(await (await me(get("/api/auth/me"))).json()).toEqual({ authenticated: false });
  });
});

describe("appconfig route", () => {
  it("401 without a session", async () => {
    expect((await getConfig(get("/api/appconfig"))).status).toBe(401);
    expect((await putConfig(put({ temperature: 1 }))).status).toBe(401);
  });
  it("GET has no secrets; PUT merges partial onto current", async () => {
    const cookie = createTestSession();
    const first = await (await getConfig(get("/api/appconfig", cookie))).json();
    expect(first).not.toHaveProperty("apiKey");
    expect(first.allowLiveExecution).toBe(false);

    expect((await putConfig(put({ temperature: 0.7, apiKey: "leak" }, cookie))).status).toBe(200);
    expect((await putConfig(put({ queryTimeoutMs: 5000 }, cookie))).status).toBe(200);
    const after = await (await getConfig(get("/api/appconfig", cookie))).json();
    expect(after.temperature).toBe(0.7);
    expect(after.queryTimeoutMs).toBe(5000);
    expect(readFileSync(cfgPath, "utf8")).not.toMatch(/apiKey|leak/);
  });
  it("rejects unsafe downloadDirectory", async () => {
    const cookie = createTestSession();
    for (const bad of ["~", "/", "/etc", "~/../x", "/tmp/elsewhere"]) {
      const res = await putConfig(put({ downloadDirectory: bad }, cookie));
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe("downloadDirectory");
    }
    expect((await putConfig(put({ downloadDirectory: "~/models-test" }, cookie))).status).toBe(200);
  });
  it("PUT invalid -> 400 with field", async () => {
    const cookie = createTestSession();
    const res = await putConfig(put({ temperature: "hot" }, cookie));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("temperature");
    expect((await putConfig(put({ defaultEngine: "oracle" }, cookie))).status).toBe(400);
    writeFileSync(cfgPath, "not json");
    expect((await getConfig(get("/api/appconfig", cookie))).status).toBe(200);
  });
});

describe("protected routes require a session", () => {
  it("returns 401 without a cookie", async () => {
    expect((await audit(get("/api/audit"))).status).toBe(401);
    expect((await analysis(get("/api/analysis"))).status).toBe(401);
    expect((await compare(post("/api/compare", { original: "a", optimized: "b" }))).status).toBe(401);
    const s = await share(get("/api/share/abc"), { params: Promise.resolve({ token: "abc" }) });
    expect(s.status).toBe(401);
  });
  it("compare validates input with a session (model run covered in compare-route.test.ts)", async () => {
    const cookie = createTestSession();
    const noModel = await compare(post("/api/compare", { original: "SELECT 1", optimized: "SELECT 2" }, cookie));
    expect(noModel.status).toBe(400);
    const bad = await compare(post("/api/compare", { modelId: "m", original: "", optimized: "x" }, cookie));
    expect(bad.status).toBe(400);
    expect((await audit(get("/api/audit", cookie))).status).toBe(200);
  });
});
