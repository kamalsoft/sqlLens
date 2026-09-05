import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { NextResponse } from "next/server";

import { readAppConfig } from "@/lib/app-config";
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
    huggingFaceToken?: string;
    apiKey?: string;
    maxConcurrentDownloads?: number;
  };
};

type HuggingFaceFile = {
  rfilename?: string;
  size?: number;
};

type ModelMetadata = {
  id: string;
  name: string;
  sourceUrl: string;
  downloadedAt: string;
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

function authHeaders(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getRepositoryFiles(
  owner: string,
  repository: string,
  token?: string,
) {
  const response = await fetch(
    `https://huggingface.co/api/models/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    {
      headers: authHeaders(token),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Unable to read Hugging Face metadata: HTTP ${response.status}`,
    );
  }

  const metadata = (await response.json()) as {
    siblings?: HuggingFaceFile[];
  };

  const files = (metadata.siblings ?? [])
    .map((file) => file.rfilename)
    .filter((file): file is string => {
      if (!file || file.startsWith(".git/") || file.includes("..")) {
        return false;
      }

      return !file.startsWith(".") || file === ".gitattributes";
    });

  if (files.length === 0) {
    throw new Error("The Hugging Face repository contains no files");
  }

  return files;
}

async function downloadFile(
  owner: string,
  repository: string,
  filename: string,
  destination: string,
  token?: string,
) {
  const url =
    `https://huggingface.co/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repository)}/resolve/main/` +
    filename.split("/").map(encodeURIComponent).join("/");

  const response = await fetch(url, {
    headers: authHeaders(token),
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${filename}: HTTP ${response.status}`);
  }

  await mkdir(path.dirname(destination), { recursive: true });

  const temporaryFile = `${destination}.part`;

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(temporaryFile),
  );

  const fileStats = await stat(temporaryFile);

  if (fileStats.size === 0) {
    throw new Error(`Downloaded file is empty: ${filename}`);
  }

  await writeFile(destination, await readFile(temporaryFile));
  await unlink(temporaryFile);
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

async function modelAlreadyInstalled(directory: string) {
  try {
    await access(path.join(directory, "sqlens-model.json"));
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let temporaryDestination: string | undefined;

  try {
    const body = (await request.json()) as DownloadRequest;
    const config = await readAppConfig();

    if (!body.modelId || !body.sourceUrl) {
      return NextResponse.json(
        { error: "modelId and sourceUrl are required" },
        { status: 400 },
      );
    }

    const { owner, repository } = validateModelUrl(body.sourceUrl);
    const root = resolveDirectory(config.downloadDirectory);
    const destination = modelDirectory(root, body.modelId);

    temporaryDestination = `${destination}.download-${Date.now()}`;

    await rm(temporaryDestination, { recursive: true, force: true });
    await mkdir(temporaryDestination, { recursive: true });

    await downloadRepository(
      owner,
      repository,
      temporaryDestination,
      config.apiKey?.trim() || undefined,
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

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Model download failed",
      },
      { status: 500 },
    );
  }
}
