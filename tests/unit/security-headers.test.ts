import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../../next.config";

describe("security headers (SEC-T3)", () => {
  it("applies CSP, framing, sniffing and referrer headers to every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/(.*)", headers: securityHeaders }]);
    const byKey = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
    expect(byKey["Content-Security-Policy"]).toMatch(/default-src 'self'/);
    expect(byKey["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(byKey["Content-Security-Policy"]).toMatch(/object-src 'none'/);
    // Tests run outside development, so no eval.
    expect(byKey["Content-Security-Policy"]).not.toMatch(/unsafe-eval/);
    expect(byKey).toMatchObject({ "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
