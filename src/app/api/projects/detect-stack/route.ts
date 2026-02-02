/**
 * Stack detection API
 * POST /api/projects/detect-stack - Auto-detect tech stack from project path
 */

import { NextResponse } from "next/server";
import { getProjectInfo } from "@/lib/stack-detector";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { path } = body as { path: string };

    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const info = await getProjectInfo(path);

    return NextResponse.json({
      stack: info.detectedStack,
      name: info.name,
      fileCount: info.fileCount,
    });
  } catch (error) {
    console.error("Stack detection error:", error);
    return NextResponse.json(
      { error: "Failed to detect stack" },
      { status: 500 }
    );
  }
}
