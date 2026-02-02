import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const assetsDir = path.join(process.cwd(), "public", "assets");
  try {
    const files = fs.readdirSync(assetsDir)
      .filter((f) => /^lilit-video-\d+\.mp4$/.test(f))
      .sort();
    return NextResponse.json({ videos: files.map((f) => `/assets/${f}`) });
  } catch {
    return NextResponse.json({ videos: [] });
  }
}
