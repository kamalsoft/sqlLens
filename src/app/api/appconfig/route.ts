import { NextResponse } from "next/server";
import { defaultAppConfig, readAppConfig, writeAppConfig } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readAppConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    const config = await writeAppConfig({
      ...defaultAppConfig,
      ...body,
    });

    return NextResponse.json(config);
  } catch {
    return NextResponse.json(
      { error: "Unable to save application settings" },
      { status: 400 }
    );
  }
}