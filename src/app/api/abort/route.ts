import { abortActiveProcess } from "@/lib/claude-code";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const { projectId } = body;

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // Set abort flag and kill worker process (which kills Claude processes)
  const aborted = abortActiveProcess(projectId);

  // Mark any running pipeline runs as aborted
  await prisma.pipelineRun.updateMany({
    where: { projectId, status: "running" },
    data: { status: "aborted" },
  });

  return NextResponse.json({ aborted, message: "Abort signal sent" });
}
