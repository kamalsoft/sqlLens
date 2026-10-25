import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientKey,
  loginAllowed,
  rateLimit,
  resetRateLimits,
  setMaxBucketsForTests,
} from "@/lib/request-guard";

const req = (xff?: string) =>
  new Request("http://localhost/api/auth/login", { headers: xff ? { "x-forwarded-for": xff } : {} });

afterEach(() => {
  resetRateLimits();
  setMaxBucketsForTests(10_000);
  vi.unstubAllEnvs();
});

describe("request-guard", () => {
  it("ignores X-Forwarded-For by default so spoofing cannot bypass the limit", () => {
    for (let i = 0; i < 5; i++) expect(loginAllowed(req(`1.2.3.${i}`), `user${i}`)).toBe(true);
    expect(loginAllowed(req("9.9.9.9"), "another")).toBe(false);
  });
  it("honours X-Forwarded-For only with SQLLENS_TRUST_PROXY=1", () => {
    expect(clientKey(req("1.2.3.4"))).toBe("local");
    vi.stubEnv("SQLLENS_TRUST_PROXY", "1");
    expect(clientKey(req("1.2.3.4, 5.6.7.8"))).toBe("1.2.3.4");
  });
  it("limits per username case-insensitively", () => {
    vi.stubEnv("SQLLENS_TRUST_PROXY", "1");
    for (let i = 0; i < 5; i++) expect(loginAllowed(req(`10.0.0.${i}`), i % 2 ? "Admin" : "admin")).toBe(true);
    expect(loginAllowed(req("10.0.0.99"), "ADMIN")).toBe(false);
  });
  it("applies a global login bucket", () => {
    vi.stubEnv("SQLLENS_TRUST_PROXY", "1");
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (loginAllowed(req(`10.1.0.${i}`), `u${i}`)) allowed++;
    expect(allowed).toBe(20);
  });
  it("a map flood evicts oldest entries and does not reset existing limits", () => {
    setMaxBucketsForTests(50);
    for (let i = 0; i < 3; i++) rateLimit("victim", 3, 60_000);
    expect(rateLimit("victim", 3, 60_000)).toBe(false);
    for (let i = 0; i < 40; i++) rateLimit(`flood${i}`, 3, 60_000);
    expect(rateLimit("victim", 3, 60_000)).toBe(false);
  });
});
