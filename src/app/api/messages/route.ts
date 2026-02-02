/**
 * GET /api/messages — retrieve inter-agent messages for a pipeline run.
 *
 * Query parameters:
 *   - pipelineRunId (string, required)
 *   - agent (string, optional) — filter by sender or recipient
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pipelineRunId = searchParams.get("pipelineRunId");
  const agent = searchParams.get("agent");

  if (!pipelineRunId) {
    return NextResponse.json(
      { error: "pipelineRunId is required" },
      { status: 400 }
    );
  }

  const where: Prisma.AgentMessageWhereInput = { pipelineRunId };

  if (agent) {
    where.OR = [{ fromAgent: agent }, { toAgent: agent }];
  }

  const messages = await prisma.agentMessage.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromAgent: true,
      fromRole: true,
      toAgent: true,
      messageType: true,
      content: true,
      phase: true,
      parentId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ messages, total: messages.length });
}
