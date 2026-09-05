import os from "node:os";
import path from "node:path";
import { readAppConfig } from "@/lib/app-config";

export async function resolveDownloadDirectory() {
  const config = await readAppConfig();
  const configured = config.downloadDirectory.trim();

  if (!configured) {
    throw new Error("downloadDirectory is missing from appconfig.json");
  }

  return path.resolve(
    configured === "~"
      ? os.homedir()
      : configured.startsWith("~/")
        ? path.join(os.homedir(), configured.slice(2))
        : configured
  );
}