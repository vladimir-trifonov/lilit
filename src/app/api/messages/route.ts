/**
 * GET /api/messages — retrieve inter-agent messages.
 *
 * Query parameters:
 *   - projectId (string) — return messages across all runs for a project
 *   - pipelineRunId (string) — return messages for a single run (legacy, still supported)
 *   - agent (string, optional) — filter by sender or recipient
 *   - after (ISO string, optional) — only return messages created after this timestamp
 *   - before (ISO string, optional) — backward pagination: messages before this timestamp
 *   - limit (int, optional) — max messages to return (default AGENT_MESSAGE_PAGE_SIZE)
 *
 * At least one of projectId or pipelineRunId is required.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TEAM_CHAT_MESSAGE_LIMIT, AGENT_MESSAGE_PAGE_SIZE } from "@/lib/constants";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const MESSAGE_SELECT = {
  id: true,
  fromAgent: true,
  fromRole: true,
  toAgent: true,
  messageType: true,
  content: true,
  phase: true,
  parentId: true,
  createdAt: true,
  pipelineRunId: true,
} as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const pipelineRunId = searchParams.get("pipelineRunId");
  const agent = searchParams.get("agent");
  const after = searchParams.get("after");
  const before = searchParams.get("before");
  const limitParam = searchParams.get("limit");
  const limit = limitParam
    ? Math.min(parseInt(limitParam, 10) || AGENT_MESSAGE_PAGE_SIZE, TEAM_CHAT_MESSAGE_LIMIT)
    : AGENT_MESSAGE_PAGE_SIZE;

  if (!projectId && !pipelineRunId) {
    return NextResponse.json(
      { error: "projectId or pipelineRunId is required" },
      { status: 400 }
    );
  }

  // Build the WHERE clause
  const where: Prisma.AgentMessageWhereInput = {};

  if (projectId) {
    // Project-scoped: join through pipelineRun to filter by projectId
    where.pipelineRun = { projectId };
  } else if (pipelineRunId) {
    // Single-run scoped (legacy path)
    let resolvedDbId = pipelineRunId;
    if (pipelineRunId.startsWith("run-")) {
      const run = await prisma.pipelineRun.findUnique({
        where: { runId: pipelineRunId },
        select: { id: true },
      });
      if (!run) {
        return NextResponse.json({ messages: [], total: 0, hasMore: false, nextCursor: null });
      }
      resolvedDbId = run.id;
    }
    where.pipelineRunId = resolvedDbId;
  }

  if (agent) {
    where.OR = [{ fromAgent: agent }, { toAgent: agent }];
  }

  // Backward pagination takes precedence over forward
  const isBackward = !!before;

  if (before) {
    const beforeDate = new Date(before);
    if (!isNaN(beforeDate.getTime())) {
      where.createdAt = { lt: beforeDate };
    }
  } else if (after) {
    const afterDate = new Date(after);
    if (!isNaN(afterDate.getTime())) {
      where.createdAt = { gt: afterDate };
    }
  }

  if (isBackward) {
    // Fetch limit + 1 in DESC order, then reverse
    const rows = await prisma.agentMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: MESSAGE_SELECT,
    });

    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    rows.reverse();

    const nextCursor = hasMore && rows.length > 0 ? rows[0].createdAt.toISOString() : null;

    return NextResponse.json({ messages: rows, total: rows.length, hasMore, nextCursor });
  }

  // Forward (default) — used by real-time polling
  const messages = await prisma.agentMessage.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
    select: MESSAGE_SELECT,
  });

  return NextResponse.json({ messages, total: messages.length, hasMore: false, nextCursor: null });
}
