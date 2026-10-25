import os from "node:os";
import path from "node:path";
import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { NextResponse } from "next/server";

import { readAppConfig } from "@/lib/app-config";
import { requireSession } from "@/lib/auth";
import { rateLimit } from "@/lib/request-guard";
import { logError } from "@/lib/redact";
import { readJson } from "@/lib/validation/body";
import { validateDownloadedModel } from "@/lib/validate-model";
import {
  ModelDownloadError,
  downloadRepository,
} from "@/lib/huggingface-download";

type DownloadRequest = {
  modelId?: string;
  name?: string;
  sourceUrl?: string;
  settings?: {
    downloadDirectory?: string;
    maxConcurrentDownloads?: number;
  };
};

function resolveDirectory(value?: string) {
  const configured = value?.trim() || "~/models";

  return path.resolve(
    configured.startsWith("~/")
      ? path.join(os.homedir(), configured.slice(2))
      : configured,
  );
}

function modelDirectory(root: string, modelId: string) {
  const safeName = modelId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const directory = path.resolve(root, safeName);

  if (!directory.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid model directory");
  }

  return directory;
}

function validateModelUrl(value: string) {
  const url = new URL(value);

  if (url.protocol !== "https:" || url.hostname !== "huggingface.co") {
    throw new Error("Only HTTPS Hugging Face URLs are supported");
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error(
      "Use a Hugging Face model URL such as https://huggingface.co/org/model. Dataset URLs are not supported.",
    );
  }

  return {
    owner: parts[0],
    repository: parts[1],
  };
}

async function calculateSize(directory: string): Promise<number> {
  let total = 0;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      total += await calculateSize(entryPath);
    } else if (!entry.name.endsWith(".part")) {
      total += (await stat(entryPath)).size;
    }
  }

  return total;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`download:${auth.session.sessionId}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Too many download requests. Try again in a minute." },
      { status: 429 },
    );
  }

  let temporaryDestination: string | undefined;

  try {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as DownloadRequest;
    const config = await readAppConfig();

    if (
      typeof body.modelId !== "string" ||
      typeof body.sourceUrl !== "string" ||
      !body.modelId ||
      !body.sourceUrl
    ) {
      return NextResponse.json(
        { error: "modelId and sourceUrl are required" },
        { status: 400 },
      );
    }

    let owner: string;
    let repository: string;
    try {
      ({ owner, repository } = validateModelUrl(body.sourceUrl));
    } catch (urlError) {
      return NextResponse.json(
        {
          error:
            urlError instanceof Error ? urlError.message : "Invalid model URL",
          field: "sourceUrl",
        },
        { status: 400 },
      );
    }
    const root = resolveDirectory(config.downloadDirectory);
    const destination = modelDirectory(root, body.modelId);

    temporaryDestination = `${destination}.download-${Date.now()}`;

    await rm(temporaryDestination, { recursive: true, force: true });
    await mkdir(temporaryDestination, { recursive: true });

    await downloadRepository(
      owner,
      repository,
      temporaryDestination,
      process.env.HF_TOKEN?.trim() || undefined,
    );

    await writeFile(
      path.join(temporaryDestination, "sqlens-model.json"),
      JSON.stringify(
        {
          id: body.modelId,
          name: body.name || body.modelId,
          sourceUrl: body.sourceUrl,
          downloadedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    const validation = await validateDownloadedModel(temporaryDestination);

    if (!validation.valid) {
      await rm(temporaryDestination, { recursive: true, force: true });

      return NextResponse.json(
        {
          error:
            "Downloaded model is incomplete or not compatible with Transformers.js.",
          modelId: body.modelId,
          validation,
        },
        { status: 422 },
      );
    }

    await rm(destination, { recursive: true, force: true });
    await rename(temporaryDestination, destination);

    return NextResponse.json({
      ok: true,
      modelId: body.modelId,
      path: destination,
      size: formatSize(await calculateSize(destination)),
      validation: await validateDownloadedModel(destination),
    });
  } catch (error) {
    if (temporaryDestination) {
      await rm(temporaryDestination, {
        recursive: true,
        force: true,
      });
    }

    if (error instanceof ModelDownloadError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: 422 },
      );
    }

    logError("Model download failed:", error);

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
