import { abortActiveProcess } from "@/lib/claude-code";
import { prisma } from "@/lib/prisma";
import { logEvent, EVENT_TYPES } from "@/lib/event-log";
import { getGraphSummary } from "@/lib/task-graph-engine";
import type { TaskGraph } from "@/types/task-graph";
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

  // Log pipeline_aborted event with task graph summary
  if (activeRun) {
    try {
      const abortedRun = await prisma.pipelineRun.findUnique({
        where: { runId: activeRun.runId },
        select: { taskGraph: true },
      });
      if (abortedRun?.taskGraph) {
        const graph = JSON.parse(abortedRun.taskGraph) as TaskGraph;
        const summary = getGraphSummary(graph);
        await logEvent({
          projectId,
          agent: "system",
          type: EVENT_TYPES.pipeline_aborted,
          data: { summary, runId: activeRun.runId },
        });
      }
    } catch {
      // Event logging is non-fatal
    }
  }

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
