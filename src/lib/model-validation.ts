import { access, readdir } from "node:fs/promises";
import path from "node:path";

export type ModelCompatibility = {
  compatible: boolean;
  kind: "onnx" | "pytorch" | "lora" | "unknown";
  missing: string[];
};

export async function validateModelDirectory(
  directory: string
): Promise<ModelCompatibility> {
  const files = new Set<string>();

  async function collect(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await collect(fullPath);
      } else {
        files.add(path.relative(directory, fullPath));
      }
    }
  }

  await collect(directory);

  const hasOnnx = [...files].some(
    (file) => file.startsWith(`onnx${path.sep}`) && file.endsWith(".onnx")
  );

  const hasSafetensors = [...files].some((file) =>
    file.endsWith(".safetensors")
  );

  const hasAdapter = files.has("adapter_config.json");

  if (hasOnnx) {
    return { compatible: true, kind: "onnx", missing: [] };
  }

  if (hasAdapter) {
    return {
      compatible: false,
      kind: "lora",
      missing: ["config.json", "onnx/*.onnx", "base model"],
    };
  }

  if (hasSafetensors) {
    return {
      compatible: false,
      kind: "pytorch",
      missing: ["onnx/*.onnx"],
    };
  }

  return {
    compatible: false,
    kind: "unknown",
    missing: ["config.json", "onnx/*.onnx"],
  };
}