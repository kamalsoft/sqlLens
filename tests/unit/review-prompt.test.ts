import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPrompt, selectPromptPath } from "@/lib/review-prompt";
import * as schema from "@/lib/review-schema";
import * as prompt from "@/lib/review-prompt";

afterEach(() => vi.unstubAllGlobals());

describe("prompt selection", () => {
  it("uses configured v2 path and throws if missing", () => {
    expect(selectPromptPath("v2", { analysisSP: "/x/a.md" })).toBe("/x/a.md");
    expect(() => selectPromptPath("v2", {})).toThrow(/not configured/);
  });
  it("uses configured v1 path, falling back to the bundled file", () => {
    expect(selectPromptPath("v1", { analysisSPv1: "/x/v1.md" })).toBe("/x/v1.md");
    expect(selectPromptPath("v1", {}, "/repo")).toBe(
      path.join("/repo", "data", "prompts", "analysisSP.v1.md"),
    );
  });
});

describe("buildPrompt", () => {
  it("wraps SQL in stored_procedure tags", () => {
    const out = buildPrompt("A {{STORED_PROCEDURE}} B", "SELECT 1");
    expect(out).toBe("A <stored_procedure>\nSELECT 1\n</stored_procedure> B");
  });
  it("rejects missing placeholder and oversize prompts", () => {
    expect(() => buildPrompt("none", "x")).toThrow(/placeholder/);
    expect(() => buildPrompt("{{STORED_PROCEDURE}}", "x".repeat(31_000))).toThrow(/too large/);
  });
  it("bundled prompts contain the placeholder", async () => {
    for (const f of ["analysisSP.md", "analysisSP.v1.md"]) {
      const t = await readFile(path.join(process.cwd(), "data", "prompts", f), "utf8");
      expect(t).toContain("{{STORED_PROCEDURE}}");
    }
  });
});

describe("local trust boundary", () => {
  it("review schema and prompt builder never call fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    buildPrompt("{{STORED_PROCEDURE}}", "SELECT 1");
    selectPromptPath("v1", {});
    expect(() => schema.validateReview("v1", {})).toThrow();
    expect(() => schema.validateReview("v2", {})).toThrow();
    expect(Object.keys(prompt).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("modules do not reference fetch in source", async () => {
    for (const f of ["review-schema.ts", "review-prompt.ts"]) {
      const t = await readFile(path.join(process.cwd(), "src", "lib", f), "utf8");
      expect(t).not.toMatch(/\bfetch\s*\(|https?:\/\//);
    }
  });
});
