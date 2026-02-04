import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { TASKS_PER_RUN_LIMIT } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline/[runId]
 * Lazy-load endpoint for expanding a past pipeline run in the activity log.
 * Returns the persisted logContent and associated tasks.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  if (!runId || !/^run-[\w-]+$/.test(runId)) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  const run = await prisma.pipelineRun.findUnique({
    where: { runId },
    select: {
      id: true,
      runId: true,
      logContent: true,
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Pipeline run not found" }, { status: 404 });
  }

  const tasks = await prisma.task.findMany({
    where: { pipelineRunId: run.id },
    orderBy: { sequenceOrder: "asc" },
    take: TASKS_PER_RUN_LIMIT,
    select: {
      id: true,
      title: true,
      description: true,
      assignedAgent: true,
      assignedRole: true,
      status: true,
      sequenceOrder: true,
      graphId: true,
      dependsOn: true,
      acceptanceCriteria: true,
      outputSummary: true,
      costUsd: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const pipelineView = tasks.map((t) => ({
    id: t.graphId ?? t.id,
    title: t.title,
    description: t.description,
    agent: t.assignedAgent ?? "unassigned",
    role: t.assignedRole ?? undefined,
    status: t.status,
    dependsOn: t.dependsOn ?? [],
    acceptanceCriteria: t.acceptanceCriteria ?? [],
    outputSummary: t.outputSummary ?? null,
    order: t.sequenceOrder,
  }));

  return NextResponse.json({
    runId: run.runId,
    logContent: run.logContent ?? null,
    tasks,
    pipelineView,
  });
}
