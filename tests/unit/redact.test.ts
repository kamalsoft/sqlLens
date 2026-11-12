import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, redact, scrubText } from "@/lib/redact";
import { rateLimit, resetRateLimits } from "@/lib/request-guard";

describe("redact", () => {
  it("redacts sensitive keys deeply without mutating input", () => {
    const input = { user: "a", password: "p", nested: { HF_TOKEN: "t", list: [{ apiKey: "k", ok: 1 }] }, connection: { host: "h" } };
    const out = redact(input) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/"p"|"t"|"k"/);
    expect(out.connection).toBe("[REDACTED]");
    expect((out.nested as { list: { ok: number }[] }).list[0].ok).toBe(1);
    expect(input.password).toBe("p");
  });
  it("redacts extended keys", () => {
    const out = redact({ pwd: 1, "api-key": 2, api_key: 3, credentials: 4, privateKey: 5, private_key: 6, safe: 7 });
    expect(out).toEqual({ pwd: "[REDACTED]", "api-key": "[REDACTED]", api_key: "[REDACTED]", credentials: "[REDACTED]", privateKey: "[REDACTED]", private_key: "[REDACTED]", safe: 7 });
  });
  it("handles cycles and errors", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(redact(new Error("boom"))).toEqual({ name: "Error", message: "boom" });
  });
  it("logError logs redacted data", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("ctx", { token: "secret" });
    expect(spy).toHaveBeenCalledWith("ctx", { token: "[REDACTED]" });
    spy.mockRestore();
  });
});

describe("rateLimit", () => {
  afterEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });
  it("blocks after the limit and refills over time", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000)).toBe(true);
    expect(rateLimit("k", 3, 60_000)).toBe(false);
    expect(rateLimit("other", 3, 60_000)).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(rateLimit("k", 3, 60_000)).toBe(true);
  });
});

describe("scrubText (SEC-T8)", () => {
  it("removes secrets, quoted names and SQL, and server addresses from logged messages", () => {
    const msg = "Login failed for user 'sa'. Server=db01.corp:1433;User Id=sa;Password=Sup3r!;Database=Sales near 'SELECT * FROM dbo.Payroll' token hf_abcdefghijk12 Bearer eyJabc.def";
    const out = scrubText(msg);
    for (const leak of ["'sa'", "Sup3r!", "db01.corp:1433", "Payroll", "hf_abcdefghijk12", "eyJabc.def"]) expect(out).not.toContain(leak);
    expect(out).toContain("Login failed for user '[…]'");
    expect(out).toContain("Password=[REDACTED]");
    expect(redact(new Error("connect to db01:1433 failed"))).toEqual({ name: "Error", message: "connect to [host]:[port] failed" });
  });
  it("removes URL credentials, key=value and JSON secrets, and double-quoted values (SEC review C1)", () => {
    const cases: [string, string][] = [
      ["connect postgres://alice:s3cret@db/app failed", "s3cret"],
      ["secret=abc123 api_key=K-999 token=TTT", "abc123"],
      ["api_key=K-999", "K-999"],
      ["token=TTT", "TTT"],
      ['{"password":"hunter2","user":"bob"}', "hunter2"],
      ['near "SELECT * FROM dbo.Payroll"', "Payroll"],
      ['Password="a b c";Server=x', "a b c"],
    ];
    for (const [text, leak] of cases) expect(scrubText(text)).not.toContain(leak);
    expect(scrubText('{"password":"hunter2"}')).toContain("[REDACTED]");
  });
  it("caps very long messages", () => {
    expect(scrubText("x".repeat(2000)).length).toBeLessThanOrEqual(501);
  });
});
