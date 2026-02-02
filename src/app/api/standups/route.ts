/**
 * GET  /api/standups — retrieve standup messages for a pipeline run or project.
 * PATCH /api/standups — update feedback on a standup message.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pipelineRunId = searchParams.get("pipelineRunId");
  const projectId = searchParams.get("projectId");
  const insightType = searchParams.get("insightType");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  if (!pipelineRunId && !projectId) {
    return NextResponse.json(
      { error: "pipelineRunId or projectId is required" },
      { status: 400 }
    );
  }

  const where: Record<string, unknown> = {};

  if (pipelineRunId) {
    where.pipelineRunId = pipelineRunId;
  } else if (projectId) {
    where.pipelineRun = { projectId };
  }

  if (insightType) {
    where.insightType = insightType;
  }

  const messages = await prisma.standupMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      pipelineRun: {
        select: { runId: true, status: true, createdAt: true },
      },
    },
  });

  const noTensionCount = messages.filter(
    (m) => m.insightType === "none"
  ).length;

  return NextResponse.json({
    standups: messages,
    total: messages.length,
    noTensionCount,
  });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { messageId, feedback } = body;

  if (!messageId) {
    return NextResponse.json(
      { error: "messageId is required" },
      { status: 400 }
    );
  }

  // feedback can be "useful", "not_useful", or null (to clear)
  if (feedback !== null && feedback !== "useful" && feedback !== "not_useful") {
    return NextResponse.json(
      { error: "feedback must be 'useful', 'not_useful', or null" },
      { status: 400 }
    );
  }

  const message = await prisma.standupMessage.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const updated = await prisma.standupMessage.update({
    where: { id: messageId },
    data: { feedback },
  });

  return NextResponse.json({ id: updated.id, feedback: updated.feedback });
}
