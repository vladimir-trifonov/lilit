import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { MESSAGE_FILE_PREFIX, PIPELINE_STALE_THRESHOLD_MS, PIPELINE_DEAD_PID_THRESHOLD_MS, PAST_RUNS_LIMIT, TASKS_PER_RUN_LIMIT } from "@/lib/constants";
import { getPidFile } from "@/lib/claude-code";
import { cleanupOrphanedRuns } from "@/lib/orphan-cleanup";

export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline?projectId=X
 * Returns the latest PipelineRun for a project.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // One-time orphan cleanup on first request after server start
  await cleanupOrphanedRuns();

  const run = await prisma.pipelineRun.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      runId: true,
      status: true,
      currentStep: true,
      pipeline: true,
      plan: true,
      completedSteps: true,
      userMessage: true,
      conversationId: true,
      runningCost: true,
      heartbeatAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!run) {
    return NextResponse.json({ status: "none" });
  }

  // ── Stale worker detection for "running" pipelines ──
  let effectiveStatus = run.status;

  if (run.status === "running" || run.status === "awaiting_plan") {
    const now = Date.now();
    const lastSignal = run.heartbeatAt ?? run.updatedAt;
    const heartbeatAge = now - lastSignal.getTime();

    // Check if worker PID is still alive
    let pidAlive = false;
    let pidKnown = false;
    try {
      const pidStr = fs.readFileSync(getPidFile(projectId), "utf-8").trim();
      const pid = parseInt(pidStr, 10);
      if (Number.isFinite(pid) && pid > 0) {
        pidKnown = true;
        try {
          process.kill(pid, 0);
          pidAlive = true;
        } catch {}
      }
    } catch {}

    // Fast path: PID confirmed dead + heartbeat stale > 2 min
    const isDeadPid = pidKnown && !pidAlive && heartbeatAge > PIPELINE_DEAD_PID_THRESHOLD_MS;
    // Slow path: heartbeat stale > 10 min (covers missing PID file, detached workers)
    const isStaleHeartbeat = heartbeatAge > PIPELINE_STALE_THRESHOLD_MS;

    if (isDeadPid || isStaleHeartbeat) {
      const reason = isDeadPid
        ? `Worker process dead (PID not found, no heartbeat for ${Math.round(heartbeatAge / 1000)}s)`
        : `Worker unresponsive (no heartbeat for ${Math.round(heartbeatAge / 1000)}s)`;

      await prisma.pipelineRun.update({
        where: { id: run.id },
        data: { status: "failed", error: reason },
      });
      effectiveStatus = "failed";
    }
  }

  const pipelineSteps = run.pipeline ? JSON.parse(run.pipeline) as string[] : [];

  // Fetch tasks for this run
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

  // Fetch past runs — only terminal runs with actual tasks
  // Excludes conversational-only runs, active pipelines, and pending confirmations
  const pastRunsCursor = searchParams.get("pastRunsCursor");
  const pastRunsWhere: Record<string, unknown> = {
    projectId,
    id: { not: run.id },
    tasks: { some: {} },
    status: { in: ["completed", "failed", "aborted"] },
  };
  if (pastRunsCursor) {
    const cursorDate = new Date(pastRunsCursor);
    if (!isNaN(cursorDate.getTime())) {
      pastRunsWhere.updatedAt = { lt: cursorDate };
    }
  }

  const pastRunsRaw = await prisma.pipelineRun.findMany({
    where: pastRunsWhere,
    orderBy: { updatedAt: "desc" },
    take: PAST_RUNS_LIMIT + 1,
    select: {
      runId: true,
      status: true,
      userMessage: true,
      runningCost: true,
      plan: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { tasks: true } },
    },
  });

  const hasMorePastRuns = pastRunsRaw.length > PAST_RUNS_LIMIT;
  if (hasMorePastRuns) pastRunsRaw.pop();

  const nextPastRunsCursor = hasMorePastRuns && pastRunsRaw.length > 0
    ? pastRunsRaw[pastRunsRaw.length - 1].updatedAt.toISOString()
    : null;

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
    status: effectiveStatus,
    runId: run.runId,
    currentStep: run.currentStep,
    totalSteps: pipelineSteps.length,
    userMessage: run.userMessage,
    conversationId: run.conversationId,
    runningCost: run.runningCost,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedSteps: run.completedSteps ?? null,
    tasks,
    pastRuns: pastRunsRaw.map((pr) => {
      let planAnalysis: string | null = null;
      if (pr.plan) {
        try {
          const parsed = JSON.parse(pr.plan);
          planAnalysis = parsed.analysis ?? null;
        } catch {}
      }
      return {
        runId: pr.runId,
        status: pr.status,
        userMessage: pr.userMessage,
        runningCost: pr.runningCost,
        planAnalysis,
        taskCount: pr._count.tasks,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      };
    }),
    hasMorePastRuns,
    pastRunsCursor: nextPastRunsCursor,
    pipelineView,
    ...(effectiveStatus === "awaiting_plan" && run.plan ? { plan: JSON.parse(run.plan) } : {}),
  });
}

/**
 * POST /api/pipeline
 * { projectId, action: "restart", runId }
 * Spawns a new worker to restart a pipeline with the same user message.
 */
export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, action, runId } = body;

  if (!projectId || !action || !runId) {
    return NextResponse.json(
      { error: "projectId, action, and runId are required" },
      { status: 400 }
    );
  }

  if (action !== "restart" && action !== "resume") {
    return NextResponse.json(
      { error: "action must be restart or resume" },
      { status: 400 }
    );
  }

  // Load the pipeline run to get conversation and message
  const run = await prisma.pipelineRun.findUnique({ where: { runId } });
  if (!run) {
    return NextResponse.json({ error: "Pipeline run not found" }, { status: 404 });
  }

  const workerScript = path.resolve(process.cwd(), "src/lib/worker.ts");

  if (action === "resume") {
    // Validate the run has a saved plan for resumption (taskGraph may be absent
    // for rejected plans — the orchestrator will build it from the plan on resume)
    if (!run.plan) {
      return NextResponse.json(
        { error: "Cannot resume: run has no saved plan" },
        { status: 400 }
      );
    }
    if (run.status !== "aborted" && run.status !== "failed") {
      return NextResponse.json(
        { error: "Can only resume aborted or failed runs" },
        { status: 400 }
      );
    }

    // Reset run status and task records for resume
    await prisma.pipelineRun.update({
      where: { runId },
      data: { status: "running", error: null, updatedAt: new Date() },
    });

    // Reset orphaned in_progress/failed tasks to assigned
    await prisma.task.updateMany({
      where: {
        pipelineRunId: run.id,
        status: { in: ["in_progress", "failed"] },
      },
      data: { status: "assigned", completedAt: null },
    });

    // Reuse the same runId — write message to temp file
    const msgFile = path.join(os.tmpdir(), `${MESSAGE_FILE_PREFIX}${runId}.txt`);
    fs.writeFileSync(msgFile, run.userMessage, "utf-8");

    const worker = spawn(
      "bunx",
      ["tsx", workerScript, projectId, run.conversationId, msgFile, runId, "--resume"],
      { cwd: process.cwd(), env: { ...process.env }, detached: true, stdio: "ignore" }
    );
    worker.unref();

    return NextResponse.json({
      success: true,
      action: "resume",
      runId,
    });
  }

  // action === "restart" — fresh start with new runId
  const newRunId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Write message to temp file (same as /api/chat) — worker expects a file path, not raw text
  const msgFile = path.join(os.tmpdir(), `${MESSAGE_FILE_PREFIX}${newRunId}.txt`);
  fs.writeFileSync(msgFile, run.userMessage, "utf-8");

  const worker = spawn(
    "bunx",
    ["tsx", workerScript, projectId, run.conversationId, msgFile, newRunId],
    { cwd: process.cwd(), env: { ...process.env }, detached: true, stdio: "ignore" }
  );
  worker.unref();

  return NextResponse.json({
    success: true,
    action: "restart",
    runId: newRunId,
  });
}
