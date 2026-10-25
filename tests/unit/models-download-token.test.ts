import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const downloadRepository = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);

vi.mock("@/lib/huggingface-download", () => ({
  ModelDownloadError: class extends Error {
    details: unknown;
  },
  downloadRepository: (...args: unknown[]) => downloadRepository(...args),
}));
vi.mock("@/lib/validate-model", () => ({
  validateDownloadedModel: async () => ({ valid: false }),
}));

import { POST } from "@/app/api/models/download/route";
import { resetRateLimits } from "@/lib/request-guard";
import { createTestSession } from "../helpers/auth";

const original = process.env.HF_TOKEN;

function req(body: unknown) {
  return new Request("http://localhost/api/models/download", {
    method: "POST",
    headers: { cookie: createTestSession(), origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/models/download token source", () => {
  beforeEach(() => {
    downloadRepository.mockClear();
    resetRateLimits();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = original;
  });

  it("passes process.env.HF_TOKEN to downloadRepository and never echoes it", async () => {
    process.env.HF_TOKEN = "hf_test_secret";
    const res = await POST(
      req({
        modelId: "tmp/hf-token-test",
        sourceUrl: "https://huggingface.co/owner/repo",
        settings: { huggingFaceToken: "body_token", apiKey: "body_key" },
      }),
    );
    expect(downloadRepository).toHaveBeenCalledTimes(1);
    expect(downloadRepository.mock.calls[0][3]).toBe("hf_test_secret");
    const text = await res.text();
    expect(text).not.toContain("hf_test_secret");
    expect(text).not.toContain("body_token");
  });

  it("passes undefined when HF_TOKEN is unset", async () => {
    delete process.env.HF_TOKEN;
    await POST(
      req({ modelId: "tmp/hf-token-test2", sourceUrl: "https://huggingface.co/o/r" }),
    );
    expect(downloadRepository.mock.calls[0][3]).toBeUndefined();
  });
});
