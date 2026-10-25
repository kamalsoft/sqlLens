import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateConfigChanges } from "@/lib/app-config";

let root: string;
let home: string;
const ok = (v: unknown) => validateConfigChanges({ downloadDirectory: v }).ok;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sqllens-cfg-")));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("downloadDirectory validation", () => {
  it("accepts a not-yet-existing dir under home", () => {
    expect(ok("~/models/new")).toBe(true);
    expect(ok(path.join(home, "a", "b"))).toBe(true);
  });
  it("rejects home itself, outside paths and dot-directories", () => {
    expect(ok("~")).toBe(false);
    expect(ok(root)).toBe(false);
    expect(ok("~/.ssh")).toBe(false);
    expect(ok("~/.aws/models")).toBe(false);
    expect(ok("~/models/.cache")).toBe(true);
  });
  it("rejects symlinks escaping home", () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(home, "link"));
    expect(ok("~/link")).toBe(false);
    expect(ok("~/link/sub")).toBe(false);
  });
  it("rejects symlinks into home dot-directories", () => {
    fs.mkdirSync(path.join(home, ".ssh"));
    fs.symlinkSync(path.join(home, ".ssh"), path.join(home, "innocent"));
    expect(ok("~/innocent")).toBe(false);
  });
});

describe("shareTtlHours", () => {
  it("caps at 720", () => {
    expect(validateConfigChanges({ shareTtlHours: 720 }).ok).toBe(true);
    expect(validateConfigChanges({ shareTtlHours: 721 }).ok).toBe(false);
  });
});
