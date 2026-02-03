import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { MESSAGE_FILE_PREFIX } from "@/lib/constants";

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
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!run) {
    return NextResponse.json({ status: "none" });
  }

  const pipelineSteps = run.pipeline ? JSON.parse(run.pipeline) as string[] : [];

  // Fetch tasks for this run
  const tasks = await prisma.task.findMany({
    where: { pipelineRunId: run.id },
    orderBy: { sequenceOrder: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      assignedAgent: true,
      assignedRole: true,
      status: true,
      sequenceOrder: true,
      outputSummary: true,
      costUsd: true,
      startedAt: true,
      completedAt: true,
    },
  });

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
    completedSteps: run.completedSteps ?? null,
    tasks,
    ...(run.status === "awaiting_plan" && run.plan ? { plan: JSON.parse(run.plan) } : {}),
  });
}

/**
 * POST /api/pipeline
 * { projectId, action: "resume" | "restart", runId }
 * Spawns a new worker to resume or restart a pipeline.
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

  // Write message to temp file (same as /api/chat) — worker expects a file path, not raw text
  const msgFile = path.join(os.tmpdir(), `${MESSAGE_FILE_PREFIX}${newRunId}.txt`);
  fs.writeFileSync(msgFile, run.userMessage, "utf-8");

  if (action === "resume") {
    // Spawn worker with resumeRunId
    const worker = spawn(
      "bunx",
      ["tsx", workerScript, projectId, run.conversationId, msgFile, newRunId, runId],
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
}
