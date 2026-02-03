import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks?pipelineRunId=X
 * Returns all tasks for a pipeline run, ordered by sequence.
 *
 * GET /api/tasks?projectId=X
 * Returns all tasks for a project (across all runs), most recent first.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pipelineRunId = searchParams.get("pipelineRunId");
  const projectId = searchParams.get("projectId");

  if (!pipelineRunId && !projectId) {
    return NextResponse.json(
      { error: "pipelineRunId or projectId is required" },
      { status: 400 },
    );
  }

  if (pipelineRunId) {
    // Resolve internal DB id from external runId
    const run = await prisma.pipelineRun.findUnique({
      where: { runId: pipelineRunId },
      select: { id: true },
    });

    if (!run) {
      return NextResponse.json({ tasks: [] });
    }

    const tasks = await prisma.task.findMany({
      where: { pipelineRunId: run.id },
      orderBy: { sequenceOrder: "asc" },
      include: { notes: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({ tasks });
  }

  // projectId query
  const tasks = await prisma.task.findMany({
    where: { projectId: projectId! },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { notes: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({ tasks });
}
