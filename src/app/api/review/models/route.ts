import { NextResponse } from "next/server";
import { getInstalledModels } from "@/lib/installed-models";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    models: await getInstalledModels(),
  });
}