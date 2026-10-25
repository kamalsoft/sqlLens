import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, redact } from "@/lib/redact";
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
