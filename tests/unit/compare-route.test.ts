import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app-config")>();
  const { readFileSync } = await import("node:fs");
  return {
    ...actual,
    readAppConfig: async () => ({
      ...actual.defaultAppConfig,
      ...JSON.parse(readFileSync(process.env.SQLLENS_CONFIG_PATH!, "utf8")),
    }),
  };
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "sqllens-compare-"));
const modelsDir = path.join(tmp, "models");
const modelDir = path.join(modelsDir, "acme_tiny");
process.env.SQLLENS_CONFIG_PATH = path.join(tmp, "appconfig.json");

import { POST as review } from "@/app/api/review/route";
import { POST as compare } from "@/app/api/compare/route";
import { POST as download } from "@/app/api/models/download/route";
import { getAudit, insertAudit } from "@/db/audit-repo";
import { setPipelineFactoryForTests, type TextGenerator } from "@/lib/inference";
import { resetRateLimits } from "@/lib/request-guard";
import { createSession, getSessionFromRequest } from "@/lib/auth";
import { seedAdmin } from "../helpers/auth";

const v2Json = {
  summary: "s",
  overallRisk: "low",
  confidence: 0.5,
  findingsTable: [],
  performanceTable: [],
  securityTable: [],
  testingTable: [],
  rewrittenProcedure: "x",
  limitations: [],
};
const cmpJson = {
  winner: "optimized",
  summary: "fewer reads",
  differences: ["explicit columns"],
  risks: [],
  confidence: 0.7,
};

function writeConfig() {
  writeFileSync(
    process.env.SQLLENS_CONFIG_PATH!,
    JSON.stringify({
      downloadDirectory: modelsDir,
      temperature: 0,
      inferenceTimeoutMs: 1000,
      prompt: { analysisSP: path.join(process.cwd(), "data", "prompts", "analysisSP.md") },
    }),
  );
}

let lastPrompt = "";
function generatorReturning(text: string): TextGenerator {
  const generator = (async (prompt: string) => {
    lastPrompt = String(prompt);
    return [{ generated_text: text }];
  }) as unknown as TextGenerator;
  generator.tokenizer = {
    apply_chat_template: (m) => m.map((x) => x.content).join("|"),
    encode: () => [1, 2, 3],
  };
  return generator;
}

const post = (url: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const stats = (simulated: boolean, reads: number, elapsed: number | null) => ({
  parseAndCompileTime: null,
  parseAndCompileCpu: null,
  executionTime: elapsed,
  executionCpu: null,
  totalElapsedMs: elapsed,
  io: [{ table: "T", scanCount: 1, logicalReads: reads, physicalReads: 0 }],
  messages: [],
  rawOutput: "SECRET RAW OUTPUT",
  simulated,
});

function seedExecute(sessionId: string, simulated: boolean, reads: number, elapsed: number | null, sql = "SELECT 1") {
  return insertAudit({
    sessionId,
    type: "EXECUTE",
    request: { original: { kind: "batch", sql } },
    response: { mode: "single", execution: { stats: stats(simulated, reads, elapsed) } },
    simulated,
  }).id;
}

let cookie: string;
const modelId = "acme/tiny";

beforeAll(() => {
  mkdirSync(path.join(modelDir, "onnx"), { recursive: true });
  writeFileSync(path.join(modelDir, "config.json"), "{}");
  writeFileSync(path.join(modelDir, "onnx", "model_q4.onnx"), "x");
  writeFileSync(path.join(modelDir, "sqllens-model.json"), JSON.stringify({ id: modelId }));
});

beforeEach(() => {
  writeConfig();
  resetRateLimits();
  setPipelineFactoryForTests(null);
  const userId = seedAdmin();
  cookie = `session_token=${createSession(userId).token}`;
});
afterEach(() => setPipelineFactoryForTests(null));

describe("review persistence and telemetry (P4-01)", () => {
  it("persists REVIEW with schema_version and model id and returns the audit id", async () => {
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    const res = await review(post("/api/review", { modelId, sql: "SELECT 1" }, cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    const stored = getAudit(body.id, sessionIdOf(cookie));
    expect(stored).toMatchObject({ type: "REVIEW", schemaVersion: "v2", modelId });
    expect(stored?.response).toEqual(body.result);
  });

  it("injects normalized telemetry from the owner's EXECUTE audit (no raw output)", async () => {
    const id = seedExecute(sessionIdOf(cookie), false, 123, 45);
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    const res = await review(
      post("/api/review", { modelId, sql: "SELECT 1", executionAuditId: id }, cookie),
    );
    expect(res.status).toBe(200);
    expect(lastPrompt).toContain('"logicalReads": 123');
    expect(lastPrompt).not.toContain("SECRET RAW OUTPUT");
    expect((await res.json()).executionAuditId).toBe(id);
  });

  it("404 for another session's or missing executionAuditId, 400 for v1", async () => {
    const other = createSession(seedAdmin());
    const otherCookie = `session_token=${other.token}`;
    const id = seedExecute(sessionIdOf(otherCookie), false, 1, 1);
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    expect(
      (await review(post("/api/review", { modelId, sql: "SELECT 1", executionAuditId: id }, cookie))).status,
    ).toBe(404);
    expect(
      (await review(post("/api/review", { modelId, sql: "SELECT 1", executionAuditId: "nope" }, cookie))).status,
    ).toBe(404);
    const own = seedExecute(sessionIdOf(cookie), false, 1, 1);
    expect(
      (
        await review(
          post("/api/review", { modelId, sql: "SELECT 1", executionAuditId: own, schemaVersion: "v1" }, cookie),
        )
      ).status,
    ).toBe(400);
  });
});

describe("POST /api/compare (P4-02)", () => {
  it("401 without a session; 400 without modelId", async () => {
    expect((await compare(post("/api/compare", { original: "a", optimized: "b", modelId }))).status).toBe(401);
    expect((await compare(post("/api/compare", { original: "a", optimized: "b" }, cookie))).status).toBe(400);
  });

  it("compares two SP texts, persists COMPARE, metrics null", async () => {
    setPipelineFactoryForTests(async () => generatorReturning("```json\n" + JSON.stringify(cmpJson) + "\n```"));
    const res = await compare(
      post("/api/compare", { modelId, original: "SELECT *", optimized: "SELECT a" }, cookie),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeNull();
    expect(lastPrompt).toContain("SELECT *");
    const stored = getAudit(body.id, sessionIdOf(cookie));
    expect(stored).toMatchObject({ type: "COMPARE", modelId });
    expect(stored?.response).toMatchObject({ result: cmpJson, metrics: null });
  });

  it("compares by audit ids and stores the metric deltas on the record", async () => {
    const sid = sessionIdOf(cookie);
    const a = seedExecute(sid, false, 100, 50, "SELECT *");
    const b = seedExecute(sid, false, 40, 20, "SELECT a");
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(cmpJson)));
    const res = await compare(
      post("/api/compare", { modelId, originalAuditId: a, optimizedAuditId: b }, cookie),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.logicalReads).toMatchObject({ original: 100, optimized: 40, delta: -60, deltaPct: -60 });
    expect(lastPrompt).toContain('"delta": -60');
    const stored = getAudit(body.id, sid);
    expect(stored?.response).toMatchObject({
      result: cmpJson,
      originalAuditId: a,
      optimizedAuditId: b,
      metrics: { logicalReads: { delta: -60 }, elapsed: { delta: -30 } },
    });
  });

  it("rejects non-SQL text", async () => {
    const res = await compare(
      post("/api/compare", { modelId, original: "hello there", optimized: "SELECT 1" }, cookie),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not look like SQL/);
  });

  it("rejects simulated vs real, foreign ids and invalid model output", async () => {
    const sid = sessionIdOf(cookie);
    const sim = seedExecute(sid, true, 1, 1);
    const real = seedExecute(sid, false, 1, 1);
    const foreign = seedExecute(sessionIdOf(`session_token=${createSession(seedAdmin()).token}`), false, 1, 1);
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(cmpJson)));
    const mixed = await compare(post("/api/compare", { modelId, originalAuditId: sim, optimizedAuditId: real }, cookie));
    expect(mixed.status).toBe(400);
    const notMine = await compare(post("/api/compare", { modelId, originalAuditId: real, optimizedAuditId: foreign }, cookie));
    expect(notMine.status).toBe(404);
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify({ winner: "both" })));
    const bad = await compare(
      post("/api/compare", { modelId, original: "SELECT 1", optimized: "SELECT 2" }, cookie),
    );
    expect(bad.status).toBe(502);
  });
});

describe("POST /api/models/download path safety (W1 #6)", () => {
  it.each([[".."], ["."]])("never removes outside the root for modelId %s", async (id) => {
    mkdirSync(modelsDir, { recursive: true });
    const marker = path.join(tmp, "marker.txt");
    writeFileSync(marker, "keep");
    const res = await download(
      post("/api/models/download", { modelId: id, sourceUrl: "https://huggingface.co/a/b" }, cookie),
    );
    expect(res.status).toBe(400);
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(modelDir)).toBe(true);
  });
});

function sessionIdOf(cookieHeader: string): string {
  const session = getSessionFromRequest(new Request("http://localhost/", { headers: { cookie: cookieHeader } }));
  return session!.sessionId;
}
