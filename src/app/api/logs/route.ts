import { getLogFile } from "@/lib/claude-code";
import { NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  if (!projectId) {
    return NextResponse.json({ log: "", offset: 0 });
  }

  try {
    const logFile = getLogFile(projectId);
    if (!fs.existsSync(logFile)) {
      return NextResponse.json({ log: "", offset: 0 });
    }

    const content = fs.readFileSync(logFile, "utf-8");
    const newContent = content.slice(offset);

    return NextResponse.json({
      log: newContent,
      offset: content.length,
    });
  } catch {
    return NextResponse.json({ log: "", offset: 0 });
  }
}
