import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ModelInfo = {
  siblings?: Array<{ rfilename?: string }>;
};

export class ModelDownloadError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ModelDownloadError";
  }
}

const REQUIRED_FILES = [
  "config.json",
  "tokenizer.json",
  "onnx/model_quantized.onnx",
] as const;

/**
 * Small files fetched when the repository has them. Without the tokenizer config and chat template an
 * instruction-tuned model cannot be prompted in its chat format, and it answers like a base model.
 */
const OPTIONAL_FILES = [
  "tokenizer_config.json",
  "chat_template.jinja",
  "chat_template.json",
  "special_tokens_map.json",
  "generation_config.json",
] as const;

export async function downloadRepository(
  owner: string,
  repository: string,
  destination: string,
  token?: string,
) {
  const headers: HeadersInit = token?.trim()
    ? { Authorization: `Bearer ${token.trim()}` }
    : {};

  // Create:
  // downloads/models/<model>/
  // downloads/models/<model>/onnx/
  await mkdir(path.join(destination, "onnx"), { recursive: true });

  const modelResponse = await fetch(
    `https://huggingface.co/api/models/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    { headers },
  );

  if (!modelResponse.ok) {
    throw new Error(`Unable to read repository: ${modelResponse.status}`);
  }

  const model = (await modelResponse.json()) as ModelInfo;

  const available = new Set(
    (model.siblings ?? [])
      .map((file) => file.rfilename)
      .filter((file): file is string => Boolean(file)),
  );

  const availableFiles = [...available].sort();
  const missingRequired = REQUIRED_FILES.filter(
    (file) => !available.has(file),
  );

  if (missingRequired.length > 0) {
    throw new ModelDownloadError(
      `Repository is missing required file(s): ${missingRequired.join(", ")}`,
      {
        owner,
        repository,
        repositoryUrl: `https://huggingface.co/${owner}/${repository}`,
        requiredFiles: REQUIRED_FILES,
        missingFiles: missingRequired,
        availableFiles,
        hasOnnxFiles: availableFiles.filter((file) => file.endsWith(".onnx")),
      },
    );
  }

  for (const file of ["config.json", "tokenizer.json", "onnx/model_quantized.onnx"]) {
    if (!available.has(file)) {
      throw new Error(`Repository is missing required file: ${file}`);
    }
  }

  const files: string[] = [...REQUIRED_FILES, ...OPTIONAL_FILES.filter((file) => available.has(file))];

  for (const filename of files) {
    const target = path.join(destination, filename);

    await mkdir(path.dirname(target), { recursive: true });

    const fileUrl =
      `https://huggingface.co/${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repository)}/resolve/main/` +
      filename
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");

    const response = await fetch(fileUrl, {
      headers,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(
        `Unable to download ${filename}: ${response.status}`,
      );
    }

    await writeFile(
      target,
      Buffer.from(await response.arrayBuffer()),
    );
  }

  return {
    destination,
    files,
    missingOptionalFiles: OPTIONAL_FILES.filter((file) => !available.has(file)),
  };
}