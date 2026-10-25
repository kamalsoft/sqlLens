import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// downloadDirectory must live under $HOME in real config validation, so the tests
// read their temp config through a bypass instead of writing into the home directory.
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "sqllens-review-"));
const modelsDir = path.join(tmp, "models");
const modelDir = path.join(modelsDir, "acme_tiny");
const smallDir = path.join(modelsDir, "acme_small");
process.env.SQLLENS_CONFIG_PATH = path.join(tmp, "appconfig.json");

import { POST as review } from "@/app/api/review/route";
import { GET as status } from "@/app/api/models/status/route";
import { POST as download } from "@/app/api/models/download/route";
import { GET as refresh } from "@/app/api/models/refresh/route";
import { GET as reviewModels } from "@/app/api/review/models/route";
import { setPipelineFactoryForTests, type TextGenerator } from "@/lib/inference";
import { resetRateLimits } from "@/lib/request-guard";
import { createTestSession } from "../helpers/auth";

const v1Json = {
  summary: "s",
  issues: [{ severity: "low", title: "t", explanation: "e", recommendation: "r" }],
  rewrittenProcedure: "x",
  confidence: 0.5,
};
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

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(
    process.env.SQLLENS_CONFIG_PATH!,
    JSON.stringify({
      downloadDirectory: modelsDir,
      temperature: 0,
      inferenceTimeoutMs: 1000,
      prompt: {
        analysisSP: path.join(process.cwd(), "data", "prompts", "analysisSP.md"),
      },
      ...extra,
    }),
  );
}

function generatorReturning(
  text: string | (() => Promise<string>),
  options: { hitTokenLimit?: boolean } = {},
): TextGenerator {
  const generator = (async () => [
    { generated_text: typeof text === "string" ? text : await text() },
  ]) as unknown as TextGenerator;
  generator.tokenizer = {
    apply_chat_template: (m) => m.map((x) => x.content).join("|"),
    // The output encodes to a huge length when simulating a used-up budget.
    encode: (value) =>
      options.hitTokenLimit && typeof text === "string" && value === text.trim()
        ? new Array(1_000_000).fill(0)
        : [1, 2, 3],
  };
  return generator;
}

const post = (url: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const get = (url: string, cookie?: string) =>
  new Request(`http://localhost${url}`, { headers: cookie ? { cookie } : {} });

const valid = { modelId: "acme/tiny", sql: "SELECT 1" };
let cookie: string;

beforeAll(() => {
  mkdirSync(path.join(modelDir, "onnx"), { recursive: true });
  writeFileSync(path.join(modelDir, "config.json"), "{}");
  writeFileSync(path.join(modelDir, "onnx", "model_q4.onnx"), "x");
  writeFileSync(path.join(modelDir, "sqlens-model.json"), JSON.stringify({ id: "acme/tiny" }));
  mkdirSync(path.join(smallDir, "onnx"), { recursive: true });
  writeFileSync(
    path.join(smallDir, "config.json"),
    JSON.stringify({ num_hidden_layers: 24, hidden_size: 896, intermediate_size: 4864, vocab_size: 151936 }),
  );
  writeFileSync(path.join(smallDir, "onnx", "model_q4.onnx"), "x");
  writeFileSync(path.join(smallDir, "sqlens-model.json"), JSON.stringify({ id: "acme/small" }));
});

beforeEach(() => {
  writeConfig();
  resetRateLimits();
  setPipelineFactoryForTests(null);
  cookie = createTestSession();
});
afterEach(() => setPipelineFactoryForTests(null));

describe("POST /api/review", () => {
  it("401 without a session", async () => {
    expect((await review(post("/api/review", valid))).status).toBe(401);
  });

  it.each([
    ["missing sql", { modelId: "acme/tiny" }],
    ["NUL in sql", { modelId: "acme/tiny", sql: "a\0b" }],
    ["non-SQL text", { modelId: "acme/tiny", sql: "please review my essay" }],
    ["missing modelId", { sql: "SELECT 1" }],
    ["bad schemaVersion", { ...valid, schemaVersion: "v9" }],
  ])("400 for %s", async (_name, body) => {
    expect((await review(post("/api/review", body, cookie))).status).toBe(400);
  });

  it("400 when SQL exceeds maxSqlLength", async () => {
    writeConfig({ maxSqlLength: 5 });
    expect((await review(post("/api/review", valid, cookie))).status).toBe(400);
  });

  it("400 when the prompt exceeds the context window", async () => {
    writeConfig({ contextWindow: 1 });
    setPipelineFactoryForTests(async () => generatorReturning("{}"));
    const response = await review(post("/api/review", valid, cookie));
    expect(response.status).toBe(400);
  });

  it("404 for an uninstalled model", async () => {
    const response = await review(post("/api/review", { ...valid, modelId: "no/such" }, cookie));
    expect(response.status).toBe(404);
  });

  it("422 for an incompatible model", async () => {
    vi.resetModules();
    vi.doMock("@/lib/installed-models", () => ({
      getInstalledModels: async () => [
        { id: "acme/tiny", name: "acme/tiny", directory: modelDir, compatible: false },
      ],
    }));
    const { POST } = await import("@/app/api/review/route");
    const { createTestSession: session } = await import("../helpers/auth");
    const response = await POST(post("/api/review", valid, session()));
    expect(response.status).toBe(422);
    vi.doUnmock("@/lib/installed-models");
    vi.resetModules();
  });

  it("200 for v2 (default) and v1 through the pipeline seam", async () => {
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    const r2 = await review(post("/api/review", valid, cookie));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ schemaVersion: "v2", model: "acme/tiny" });

    setPipelineFactoryForTests(async () =>
      generatorReturning("```json\n" + JSON.stringify(v1Json) + "\n```"),
    );
    const r1 = await review(post("/api/review", { ...valid, schemaVersion: "v1" }, cookie));
    expect(r1.status).toBe(200);
    expect((await r1.json()).result).toHaveProperty("issues");
  });

  it("small model defaults to v1 with lowConfidence; explicit v2 is honoured", async () => {
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v1Json)));
    const r1 = await review(post("/api/review", { ...valid, modelId: "acme/small" }, cookie));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ schemaVersion: "v1", lowConfidence: true });

    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    const r2 = await review(
      post("/api/review", { ...valid, modelId: "acme/small", schemaVersion: "v2" }, cookie),
    );
    expect(await r2.json()).toMatchObject({ schemaVersion: "v2", lowConfidence: true });
  });

  it("unknown-size model is not small", async () => {
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    const body = await (await review(post("/api/review", valid, cookie))).json();
    expect(body).toMatchObject({ schemaVersion: "v2", lowConfidence: false });
  });

  it("review/models and status expose parameterEstimate and small", async () => {
    const list = (await (await reviewModels(get("/api/review/models", cookie))).json()).models;
    expect(list.find((m: { id: string }) => m.id === "acme/small")).toMatchObject({ small: true });
    expect(list.find((m: { id: string }) => m.id === "acme/small").parameterEstimate).toBeGreaterThan(5e8);
    expect(list.find((m: { id: string }) => m.id === "acme/tiny")).toMatchObject({
      small: false,
      parameterEstimate: null,
    });
    const st = (await (await status(get("/api/models/status", cookie))).json()).models;
    expect(st.find((m: { id: string }) => m.id === "acme/small")).toMatchObject({ small: true });
  });

  it("502 for non-JSON or schema-invalid output", async () => {
    setPipelineFactoryForTests(async () => generatorReturning("not json at all"));
    const res = await review(post("/api/review", valid, cookie));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.details.responseText).toBe("not json at all");
    expect(body.error).toBe("Unable to parse model response");
  });

  it("keeps only index recommendations verified against the SQL, with generated DDL", async () => {
    const sql = "SELECT o.Id, o.Total FROM dbo.Orders AS o WHERE o.CustomerId = @CustomerId";
    const answer = JSON.stringify({
      summary: "s",
      issues: [],
      confidence: 0.5,
      indexRecommendations: [
        { table: "dbo.Orders", keyColumns: ["CustomerId"], includeColumns: ["Total"], reason: "seek on CustomerId" },
        { table: "o", keyColumns: ["CustomerId"] },
        { table: "dbo.Orders", keyColumns: ["ShipDate"] },
      ],
      rewrittenProcedure: "",
    });
    setPipelineFactoryForTests(async () => generatorReturning(answer));
    const res = await review(post("/api/review", { modelId: "acme/tiny", sql, schemaVersion: "v1" }, cookie));
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.indexRecommendations).toHaveLength(1);
    expect(result.indexRecommendations[0].createStatement).toBe(
      "CREATE NONCLUSTERED INDEX [IX_Orders_CustomerId] ON [dbo].[Orders] ([CustomerId]) INCLUDE ([Total]);",
    );
  });

  it("accepts a v1-shaped answer to a v2 request and flags the fallback", async () => {
    const v1Answer = JSON.stringify({
      summary: "s",
      issues: [{ severity: "high", title: "t", explanation: "e" }],
    });
    setPipelineFactoryForTests(async () => generatorReturning("```json\n" + v1Answer + "\n```"));
    const res = await review(post("/api/review", { ...valid, schemaVersion: "v2" }, cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ schemaVersion: "v1", schemaFallback: true, lowConfidence: true });
    expect(body.result.issues[0]).toMatchObject({ title: "t", recommendation: "" });
  });

  it("502 says the model looped when cut-off output repeats", async () => {
    const loop = '{"summary": "s", "issues": [' + '{"title": "Use sp_executesql for safety"},\n'.repeat(8);
    setPipelineFactoryForTests(async () => generatorReturning(loop, { hitTokenLimit: true }));
    const body = await (await review(post("/api/review", valid, cookie))).json();
    expect(body.error).toMatch(/stuck repeating itself/);
  });

  it("502 reports truncation only when the token budget was used up", async () => {
    const partial = '{"summary": "s", "issues": [';
    setPipelineFactoryForTests(async () => generatorReturning(partial, { hitTokenLimit: true }));
    expect((await (await review(post("/api/review", valid, cookie))).json()).error).toMatch(/cut off/);

    setPipelineFactoryForTests(async () => generatorReturning(partial));
    expect((await (await review(post("/api/review", valid, cookie))).json()).error).toMatch(
      /stopped before finishing/,
    );
  });

  it("recovers an answer that stopped inside its final string value", async () => {
    const stopped =
      '{"summary": "s", "issues": [{"severity": "high", "title": "t", "explanation": "e"}],\n' +
      '"rewrittenProcedure": "CREATE PROCEDURE dbo.p\nAS\nBEGIN\n  SELECT 1;\nEND;';
    setPipelineFactoryForTests(async () => generatorReturning(stopped));
    const res = await review(post("/api/review", { ...valid, schemaVersion: "v1" }, cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.rewrittenProcedure).toBe("CREATE PROCEDURE dbo.p\nAS\nBEGIN\n  SELECT 1;\nEND;");

    expect(body.result.rewriteStatus).toBe("provided");

    // Cut off by the token budget inside the rewrite: keep the review, drop the partial SQL.
    setPipelineFactoryForTests(async () => generatorReturning(stopped, { hitTokenLimit: true }));
    const cut = await review(post("/api/review", { ...valid, schemaVersion: "v1" }, cookie));
    expect(cut.status).toBe(200);
    expect((await cut.json()).result).toMatchObject({ rewriteStatus: "truncated", rewrittenProcedure: "", rewriteNotes: [] });

    // Cut off earlier (inside the issues list): never recovered.
    const early = '{"summary": "s", "issues": [{"severity": "high", "title": "t", "explanation": "e"}, {"sev';
    setPipelineFactoryForTests(async () => generatorReturning(early, { hitTokenLimit: true }));
    expect((await review(post("/api/review", { ...valid, schemaVersion: "v1" }, cookie))).status).toBe(502);
  });

  it("takes the rewrite from the plain-SQL block after the JSON", async () => {
    const json = JSON.stringify({ summary: "s", issues: [], rewriteNotes: ["Added NOCOUNT"] });
    const block = "CREATE PROCEDURE dbo.p AS\nBEGIN\n  SET NOCOUNT ON;\n  SELECT 'it''s \"quoted\"';\nEND";
    setPipelineFactoryForTests(async () => generatorReturning(`${json}\n<rewritten_procedure>\n${block}\n</rewritten_procedure>`));
    const ok = await (await review(post("/api/review", { ...valid, schemaVersion: "v1" }, cookie))).json();
    expect(ok.result).toMatchObject({ rewriteStatus: "provided", rewrittenProcedure: block, rewriteNotes: ["Added NOCOUNT"] });

    // Block left open because the token limit was hit: review kept, rewrite dropped.
    const open = `${json}\n<rewritten_procedure>\nCREATE PROCEDURE dbo.p AS\nBEGIN\n  SET NOCOUNT ON;`;
    setPipelineFactoryForTests(async () => generatorReturning(open, { hitTokenLimit: true }));
    const cut = await (await review(post("/api/review", { ...valid, schemaVersion: "v1" }, cookie))).json();
    expect(cut.result).toMatchObject({ rewriteStatus: "truncated", rewrittenProcedure: "" });
  });

  it("removes a rewrite that writes to tables the original does not", async () => {
    const sql = "CREATE PROCEDURE dbo.p AS SELECT o.Id FROM dbo.Orders AS o";
    const answer = JSON.stringify({
      summary: "s",
      issues: [],
      rewriteNotes: ["Persist results"],
      rewrittenProcedure: "CREATE PROCEDURE dbo.p AS BEGIN SELECT o.Id FROM dbo.Orders AS o; INSERT INTO dbo.Orders (Id) SELECT 1; END",
    });
    setPipelineFactoryForTests(async () => generatorReturning(answer));
    const res = await review(post("/api/review", { modelId: "acme/tiny", sql, schemaVersion: "v1" }, cookie));
    const { result } = await res.json();
    expect(result).toMatchObject({ rewriteStatus: "unsafe", rewriteDetail: "Writes to orders", rewrittenProcedure: "", rewriteNotes: [] });
  });

  it("removes a rewrite that is not SQL and reports why", async () => {
    const answer = JSON.stringify({
      summary: "s",
      issues: [],
      rewriteNotes: ["<one change made in the rewrite and why>"],
      rewrittenProcedure: "<the complete restructured procedure>",
    });
    setPipelineFactoryForTests(async () => generatorReturning(answer));
    const { result } = await (await review(post("/api/review", { ...valid, schemaVersion: "v1" }, cookie))).json();
    expect(result).toMatchObject({ rewriteStatus: "invalid", rewrittenProcedure: "", rewriteNotes: [] });
  });

  it("504 on timeout, then 429 while the slow generation still runs", async () => {
    let release: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    setPipelineFactoryForTests(async () => generatorReturning(() => slow));
    const timedOut = await review(post("/api/review", valid, cookie));
    expect(timedOut.status).toBe(504);
    expect((await timedOut.json()).error).toMatch(/inferenceTimeoutMs/);

    const busy = await review(post("/api/review", valid, cookie));
    expect(busy.status).toBe(429);
    release("{}");
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("429 once the per-session rate limit is exceeded", async () => {
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    for (let i = 0; i < 5; i += 1) {
      expect((await review(post("/api/review", valid, cookie))).status).toBe(200);
    }
    expect((await review(post("/api/review", valid, cookie))).status).toBe(429);
  });

  it("500 is generic", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setPipelineFactoryForTests(async () => {
      throw new Error("secret path /etc/x");
    });
    const response = await review(post("/api/review", valid, cookie));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error" });
    spy.mockRestore();
  });
});

describe("model routes", () => {
  it("GET /api/models/status 401 and 200", async () => {
    expect((await status(get("/api/models/status"))).status).toBe(401);
    const response = await status(get("/api/models/status", cookie));
    expect(response.status).toBe(200);
    const { models } = await response.json();
    expect(models).toContainEqual({
      id: "acme/tiny",
      name: "acme/tiny",
      compatible: true,
      parameterEstimate: null,
      small: false,
      loaded: false,
      loading: false,
      lastError: null,
    });
  });

  it("status reflects a loaded model", async () => {
    setPipelineFactoryForTests(async () => generatorReturning(JSON.stringify(v2Json)));
    await review(post("/api/review", valid, cookie));
    const { models } = await (await status(get("/api/models/status", cookie))).json();
    expect(models.find((m: { id: string }) => m.id === "acme/tiny").loaded).toBe(true);
  });

  it("POST /api/models/download 401 without a session", async () => {
    const response = await download(
      post("/api/models/download", { modelId: "a/b", sourceUrl: "https://huggingface.co/a/b" }),
    );
    expect(response.status).toBe(401);
  });

  it("GET refresh and review/models require a session", async () => {
    expect((await refresh(get("/api/models/refresh"))).status).toBe(401);
    expect((await reviewModels(get("/api/review/models"))).status).toBe(401);
  });
});
