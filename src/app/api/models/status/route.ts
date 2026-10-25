import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getInstalledModels } from "@/lib/installed-models";
import { getModelStatus } from "@/lib/inference";
import { logError } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const status = getModelStatus();
    const models = (await getInstalledModels()).map((model) => {
      const state = status[model.directory];
      return {
        id: model.id,
        name: model.name,
        compatible: model.compatible,
        loaded: state?.loaded ?? false,
        loading: state?.loading ?? false,
        lastError: state?.lastError ?? null,
      };
    });
    return NextResponse.json({ models });
  } catch (error) {
    logError("Model status failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
