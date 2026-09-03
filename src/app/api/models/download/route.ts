import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const getDefaultUrl = (provider: string, modelName: string) => {
  const normalized = modelName.toLowerCase();

  switch (provider.toLowerCase()) {
    case "openai":
      return `https://example.com/models/${normalized}.bin`;
    case "hugging face":
      return `https://huggingface.co/${normalized}/resolve/main/model.bin`;
    case "ollama":
      return `https://ollama.com/library/${normalized}.gguf`;
    default:
      return `https://example.com/models/${normalized}.bin`;
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const modelId = String(body.modelId || "").trim();
    const modelName = String(body.name || modelId || "model").trim();
    const provider = String(body.provider || "OpenAI").trim();
    const sourceUrl = String(body.sourceUrl || getDefaultUrl(provider, modelName)).trim();

    if (!modelId) {
      return NextResponse.json(
        { error: "modelId is required" },
        { status: 400 }
      );
    }

    const safeDir = path.join(process.cwd(), "downloads", "models", modelId);
    await fs.mkdir(safeDir, { recursive: true });

    const targetPath = path.join(safeDir, `${modelName.replace(/[^a-z0-9._-]/gi, "-")}.bin`);

    const response = await fetch(sourceUrl, {
      method: "GET",
      headers: {
        Accept: "*/*",
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Download failed for ${modelName}: ${response.status}`);
    }

    const fileStream = await response.arrayBuffer();
    await fs.writeFile(targetPath, Buffer.from(fileStream));

    return NextResponse.json({
      ok: true,
      status: "installed",
      path: targetPath,
      size: `${(Buffer.byteLength(fileStream) / (1024 * 1024)).toFixed(1)} MB`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown download error",
      },
      { status: 500 }
    );
  }
}