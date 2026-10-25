import { describe, expect, it } from "vitest";
import { estimateParameters, isSmallModel } from "@/lib/model-size";

const qwen05 = { num_hidden_layers: 24, hidden_size: 896, intermediate_size: 4864, vocab_size: 151936 };
const qwen15 = { num_hidden_layers: 28, hidden_size: 1536, intermediate_size: 8960, vocab_size: 151936 };

describe("model size", () => {
  it("estimates Qwen2.5 sizes", () => {
    expect(estimateParameters(qwen05)! / 1e9).toBeCloseTo(0.53, 1);
    expect(estimateParameters(qwen15)! / 1e9).toBeCloseTo(1.65, 1);
  });
  it("returns null for unknown config", () => {
    expect(estimateParameters(null)).toBeNull();
    expect(estimateParameters({ hidden_size: 10 })).toBeNull();
    expect(estimateParameters({ ...qwen05, vocab_size: "x" })).toBeNull();
  });
  it("small only when known and under 1B", () => {
    expect(isSmallModel(estimateParameters(qwen05))).toBe(true);
    expect(isSmallModel(estimateParameters(qwen15))).toBe(false);
    expect(isSmallModel(null)).toBe(false);
  });
});
