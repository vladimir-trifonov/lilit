import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

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

  const run = await prisma.pipelineRun.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: {
      runId: true,
      status: true,
      currentStep: true,
      pipeline: true,
      userMessage: true,
      conversationId: true,
      runningCost: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!run) {
    return NextResponse.json({ status: "none" });
  }

  const pipelineSteps = run.pipeline ? JSON.parse(run.pipeline) as string[] : [];

  return NextResponse.json({
    status: run.status,
    runId: run.runId,
    currentStep: run.currentStep,
    totalSteps: pipelineSteps.length,
    userMessage: run.userMessage,
    conversationId: run.conversationId,
    runningCost: run.runningCost,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
}

/**
 * POST /api/pipeline
 * { projectId, action: "resume" | "restart", runId }
 * Spawns a new worker to resume or restart a pipeline.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { projectId, action, runId } = body;

  if (!projectId || !action || !runId) {
    return NextResponse.json(
      { error: "projectId, action, and runId are required" },
      { status: 400 }
    );
  }

  if (!["resume", "restart"].includes(action)) {
    return NextResponse.json(
      { error: "action must be resume or restart" },
      { status: 400 }
    );
  }

  // Load the pipeline run to get conversation and message
  const run = await prisma.pipelineRun.findUnique({ where: { runId } });
  if (!run) {
    return NextResponse.json({ error: "Pipeline run not found" }, { status: 404 });
  }

  const workerScript = path.resolve(process.cwd(), "src/lib/worker.ts");
  const newRunId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (action === "resume") {
    // Spawn worker with resumeRunId
    const worker = spawn(
      "bunx",
      ["tsx", workerScript, projectId, run.conversationId, run.userMessage, newRunId, runId],
      { cwd: process.cwd(), env: { ...process.env }, detached: true, stdio: "ignore" }
    );
    worker.unref();

    return NextResponse.json({
      success: true,
      action: "resume",
      runId: runId,
      newRunId,
    });
  } else {
    // Restart: spawn a fresh worker with the same userMessage
    const worker = spawn(
      "bunx",
      ["tsx", workerScript, projectId, run.conversationId, run.userMessage, newRunId],
      { cwd: process.cwd(), env: { ...process.env }, detached: true, stdio: "ignore" }
    );
    worker.unref();

    return NextResponse.json({
      success: true,
      action: "restart",
      runId: newRunId,
    });
  }
}
