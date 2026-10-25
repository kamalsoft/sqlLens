import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Never let a test open the real database or write into the repository (contract C16).
process.env.SQLLENS_DB_DIR = mkdtempSync(path.join(os.tmpdir(), "sqllens-test-db-"));
process.env.SQLLENS_AUDIT_LOG_DIR = mkdtempSync(path.join(os.tmpdir(), "sqllens-test-audit-"));

afterEach(() => {
  cleanup();
});
