import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const { projectId, message } = body;

  if (!projectId || !message) {
    return NextResponse.json(
      { error: "projectId and message are required" },
      { status: 400 }
    );
  }

  // Get or create conversation
  let conversation = await prisma.conversation.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
  });

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

  // Run pipeline in a separate Node.js process (Next.js Turbopack kills child processes)
  const workerScript = path.resolve(process.cwd(), "src/lib/worker.ts");

  try {
    const result = await new Promise<{
      success: boolean;
      response?: string;
      steps?: unknown[];
      error?: string;
    }>((resolve) => {
      const chunks: string[] = [];
      const errChunks: string[] = [];

      const worker = spawn("bunx", ["tsx", workerScript, projectId, conversation!.id, message], {
        cwd: process.cwd(),
        env: { ...process.env },
      });

      worker.stdout.on("data", (data) => chunks.push(data.toString()));
      worker.stderr.on("data", (data) => errChunks.push(data.toString()));

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
      }, 3_600_000);
    });

    if (result.success && result.response) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: result.response,
          metadata: JSON.stringify({ steps: result.steps }),
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      return NextResponse.json({
        response: result.response,
        steps: result.steps,
        conversationId: conversation.id,
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

      return NextResponse.json({ error: errorMessage }, { status: 500 });
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
