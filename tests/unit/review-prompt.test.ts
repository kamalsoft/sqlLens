import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedPromptPath } from "@/lib/prompt-path";
import { validateConfigChanges } from "@/lib/app-config";
import { buildPrompt, selectPromptPath } from "@/lib/review-prompt";
import * as schema from "@/lib/review-schema";
import * as prompt from "@/lib/review-prompt";

afterEach(() => vi.unstubAllGlobals());

describe("prompt selection (SEC-2)", () => {
  const bundled = (f: string) => path.join(process.cwd(), "data", "prompts", f);
  it("uses a configured prompt inside data/prompts/, otherwise the bundled file", () => {
    expect(selectPromptPath("v2", { analysisSP: "data/prompts/analysisSP-verylarge.md" })).toBe(realpathSync(bundled("analysisSP-verylarge.md")));
    expect(selectPromptPath("v2", {})).toBe(bundled("analysisSP.md"));
    expect(selectPromptPath("v1", {}, "/repo")).toBe(path.join("/repo", "data", "prompts", "analysisSP.v1.md"));
  });
  it.each([
    ["a file outside data/prompts/", "/etc/hosts"],
    ["a non-.md file", "data/prompts/../../package.json"],
    ["a traversal that ends in .md", "data/prompts/../../README.md"],
    ["a home-folder path", "~/.ssh/id_rsa.md"],
    ["a missing file", "data/prompts/nope.md"],
  ])("ignores %s and uses the bundled prompt", (_name, value) => {
    expect(allowedPromptPath(value)).toBeNull();
    expect(selectPromptPath("v1", { analysisSPv1: value })).toBe(bundled("analysisSP.v1.md"));
  });
  it("rejects a symlink inside data/prompts/ that points outside", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sqllens-prompt-"));
    mkdirSync(path.join(dir, "data", "prompts"), { recursive: true });
    writeFileSync(path.join(dir, "secret.md"), "secret");
    symlinkSync(path.join(dir, "secret.md"), path.join(dir, "data", "prompts", "link.md"));
    writeFileSync(path.join(dir, "data", "prompts", "ok.md"), "ok");
    expect(allowedPromptPath("data/prompts/link.md", dir)).toBeNull();
    expect(allowedPromptPath("data/prompts/ok.md", dir)).toBe(realpathSync(path.join(dir, "data", "prompts", "ok.md")));
  });
  it("Settings refuses a prompt path outside data/prompts/", () => {
    expect(validateConfigChanges({ prompt: { refactor: "/etc/passwd" } })).toEqual({ ok: false, field: "prompt" });
    expect(validateConfigChanges({ prompt: { refactor: "data/prompts/refactor.md" } }).ok).toBe(true);
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
