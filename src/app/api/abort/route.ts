import { abortActiveProcess } from "@/lib/claude-code";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId } = body;

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // Set abort flag and kill worker process (which kills Claude processes)
  const aborted = abortActiveProcess(projectId);

  // Find the active run so we can return its info for resume
  const activeRun = await prisma.pipelineRun.findFirst({
    where: { projectId, status: { in: ["running", "awaiting_plan"] } },
    orderBy: { updatedAt: "desc" },
    select: { runId: true, currentStep: true, pipeline: true, userMessage: true },
  });

  // Mark any active pipeline runs as aborted
  await prisma.pipelineRun.updateMany({
    where: { projectId, status: { in: ["running", "awaiting_plan"] } },
    data: { status: "aborted" },
  });

  const pipelineSteps = activeRun?.pipeline ? JSON.parse(activeRun.pipeline) as string[] : [];

  return NextResponse.json({
    aborted,
    message: "Abort signal sent",
    run: activeRun ? {
      runId: activeRun.runId,
      currentStep: activeRun.currentStep,
      totalSteps: pipelineSteps.length,
      userMessage: activeRun.userMessage,
    } : null,
  });
}
