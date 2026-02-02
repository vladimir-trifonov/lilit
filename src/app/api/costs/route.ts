/**
 * Cost tracking API
 * GET /api/costs?projectId=xxx - Get cost summary for a project
 * GET /api/costs?conversationId=xxx - Get cost for a conversation
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const conversationId = searchParams.get("conversationId");

  if (!projectId && !conversationId) {
    return NextResponse.json(
      { error: "projectId or conversationId required" },
      { status: 400 }
    );
  }

  try {
    if (conversationId) {
      // Get costs for a specific conversation via pipeline run FK
      const pipelineRuns = await prisma.pipelineRun.findMany({
        where: { conversationId },
        select: { id: true },
      });

      if (pipelineRuns.length === 0) {
        return NextResponse.json({
          conversationId,
          totalCost: 0,
          totalTokens: 0,
          runCount: 0,
          byAgent: {},
          runs: [],
        });
      }

      const pipelineRunIds = pipelineRuns.map((r) => r.id);

      const runs = await prisma.agentRun.findMany({
        where: { pipelineRunId: { in: pipelineRunIds } },
        orderBy: { createdAt: "asc" },
      });

      const totalCost = runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
      const totalTokens = runs.reduce((sum, run) => sum + (run.tokensUsed ?? 0), 0);

      const byAgent = runs.reduce(
        (acc, run) => {
          const key = run.role ? `${run.agent}:${run.role}` : run.agent;
          if (!acc[key]) {
            acc[key] = { cost: 0, tokens: 0, count: 0 };
          }
          acc[key].cost += run.costUsd ?? 0;
          acc[key].tokens += run.tokensUsed ?? 0;
          acc[key].count++;
          return acc;
        },
        {} as Record<string, { cost: number; tokens: number; count: number }>
      );

      return NextResponse.json({
        conversationId,
        totalCost,
        totalTokens,
        runCount: runs.length,
        byAgent,
        runs: runs.map((r) => ({
          id: r.id,
          agent: r.agent,
          role: r.role,
          model: r.model,
          cost: r.costUsd,
          tokens: r.tokensUsed,
          duration: r.durationMs,
          createdAt: r.createdAt,
        })),
      });
    }

    // Get costs for entire project
    const runs = await prisma.agentRun.findMany({
      where: { projectId: projectId! },
      orderBy: { createdAt: "desc" },
    });

    const totalCost = runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
    const totalTokens = runs.reduce((sum, run) => sum + (run.tokensUsed ?? 0), 0);

    const byAgent = runs.reduce(
      (acc, run) => {
        const key = run.role ? `${run.agent}:${run.role}` : run.agent;
        if (!acc[key]) {
          acc[key] = { cost: 0, tokens: 0, count: 0 };
        }
        acc[key].cost += run.costUsd ?? 0;
        acc[key].tokens += run.tokensUsed ?? 0;
        acc[key].count++;
        return acc;
      },
      {} as Record<string, { cost: number; tokens: number; count: number }>
    );

    // Get cost by date (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentRuns = runs.filter((r) => r.createdAt >= thirtyDaysAgo);
    const costByDate = recentRuns.reduce(
      (acc, run) => {
        const date = run.createdAt.toISOString().split("T")[0];
        if (!acc[date]) {
          acc[date] = { cost: 0, tokens: 0, count: 0 };
        }
        acc[date].cost += run.costUsd ?? 0;
        acc[date].tokens += run.tokensUsed ?? 0;
        acc[date].count++;
        return acc;
      },
      {} as Record<string, { cost: number; tokens: number; count: number }>
    );

    return NextResponse.json({
      projectId,
      totalCost,
      totalTokens,
      runCount: runs.length,
      byAgent,
      costByDate,
    });
  } catch (error) {
    console.error("Cost API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch costs" },
      { status: 500 }
    );
  }
}
