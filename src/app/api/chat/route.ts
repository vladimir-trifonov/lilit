import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { WORKER_TIMEOUT_MS, MESSAGE_FILE_PREFIX, WORKER_STDERR_MAX_LENGTH } from "@/lib/constants";
import { writeUserMessage } from "@/lib/user-message-gate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, message, conversationId } = body;

  if (!projectId || !message) {
    return NextResponse.json(
      { error: "projectId and message are required" },
      { status: 400 }
    );
  }

  // Check for active pipeline — queue user message instead of blocking
  const activeRun = await prisma.pipelineRun.findFirst({
    where: { projectId, status: { in: ["running", "awaiting_plan"] } },
  });
  if (activeRun) {
    // Queue message for the running pipeline's PM decision loop
    writeUserMessage(projectId, activeRun.runId, message);

    // Also save to conversation for history
    const conv = conversationId
      ? await prisma.conversation.findFirst({ where: { id: conversationId, projectId } })
      : null;
    const targetConvId = conv?.id ?? activeRun.conversationId;

    await prisma.message.create({
      data: {
        conversationId: targetConvId,
        role: "user",
        content: message,
      },
    });

    return NextResponse.json({
      status: "message_queued",
      runId: activeRun.runId,
      conversationId: targetConvId,
    });
  }

  // Use provided conversationId, or create a new conversation
  let conversation;

  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, projectId },
    });
  }

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { projectId },
    });
  }

  // Save user message
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: message,
    },
  });

  // Generate runId here so we can return it immediately
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create PipelineRun record eagerly so the UI status polling finds it
  // immediately, even while `bunx tsx` is still bootstrapping the worker.
  await prisma.pipelineRun.create({
    data: {
      projectId,
      conversationId: conversation.id,
      runId,
      userMessage: message,
      status: "running",
    },
  });

  // Run pipeline in a separate Node.js process (Next.js Turbopack kills child processes)
  const workerScript = path.resolve(process.cwd(), "src/lib/worker.ts");

  try {
    const result = await new Promise<{
      success: boolean;
      response?: string;
      steps?: unknown[];
      standup?: { messages: unknown[]; totalCost: number };
      agentMessages?: unknown[];
      adaptations?: unknown[];
      error?: string;
      runId?: string;
    }>((resolve) => {
      const chunks: string[] = [];
      const errChunks: string[] = [];

      const msgFile = path.join(os.tmpdir(), `${MESSAGE_FILE_PREFIX}${runId}.txt`);
      fs.writeFileSync(msgFile, message, "utf-8");

      const worker = spawn("bunx", ["tsx", workerScript, projectId, conversation!.id, msgFile, runId], {
        cwd: process.cwd(),
        env: { ...process.env },
      });

      worker.stdout.on("data", (data) => chunks.push(data.toString()));
      worker.stderr.on("data", (data) => {
        const text = data.toString();
        errChunks.push(text);
        const truncated = text.length > WORKER_STDERR_MAX_LENGTH ? text.slice(0, WORKER_STDERR_MAX_LENGTH) + "..." : text;
        console.error(`[worker:${runId}] ${truncated}`);
      });

      worker.on("close", (code) => {
        const output = chunks.join("");
        try {
          resolve(JSON.parse(output));
        } catch {
          resolve({
            success: false,
            error: errChunks.join("") || output || `Worker exit ${code}`,
          });
        }
      });

      // 60 min timeout (increased from 10min for complex pipelines)
      setTimeout(() => {
        worker.kill("SIGKILL");
        resolve({ success: false, error: "Pipeline timeout (60min)" });
      }, WORKER_TIMEOUT_MS);
    });

    if (result.success && result.response) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: result.response,
          metadata: JSON.stringify({ steps: result.steps, standup: result.standup, agentMessages: result.agentMessages, adaptations: result.adaptations }),
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      return NextResponse.json({
        response: result.response,
        steps: result.steps,
        standup: result.standup,
        agentMessages: result.agentMessages,
        adaptations: result.adaptations,
        conversationId: conversation.id,
        runId: result.runId ?? runId,
      });
    } else {
      const errorMessage = result.error || "Pipeline failed";

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "system",
          content: `Error: ${errorMessage}`,
        },
      });

      return NextResponse.json({ error: errorMessage, runId }, { status: 500 });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const conversationId = searchParams.get("conversationId");

  if (!projectId && !conversationId) {
    return NextResponse.json(
      { error: "projectId or conversationId is required" },
      { status: 400 }
    );
  }

  let conversation;

  if (conversationId) {
    // Get specific conversation
    conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  } else {
    // Get latest conversation for project
    conversation = await prisma.conversation.findFirst({
      where: { projectId: projectId! },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  return NextResponse.json({
    conversationId: conversation?.id || null,
    messages: conversation?.messages ?? [],
  });
}
