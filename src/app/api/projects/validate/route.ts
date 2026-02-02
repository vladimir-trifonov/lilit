/**
 * Validate project path API
 * POST /api/projects/validate - Check if path exists and is accessible
 */

import { NextResponse } from "next/server";
import { validateProjectPath } from "@/lib/stack-detector";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { path } = body as { path: string };

    if (!path) {
      return NextResponse.json({ valid: false, error: "Path is required" }, { status: 400 });
    }

    const validation = validateProjectPath(path);

    return NextResponse.json(validation);
  } catch (error) {
    console.error("Validation error:", error);
    return NextResponse.json(
      { valid: false, error: "Validation failed" },
      { status: 500 }
    );
  }
}
