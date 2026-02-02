import { abortActiveProcess } from "@/lib/claude-code";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  // Set abort flag and kill worker process (which kills Claude processes)
  const aborted = abortActiveProcess();
  return NextResponse.json({ aborted, message: "Abort signal sent" });
}
