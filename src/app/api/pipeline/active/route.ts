import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { ACTIVE_PIPELINE_LIMIT } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline/active
 * Returns all projectIds with running or awaiting_plan PipelineRuns.
 * Used by the sidebar to show running indicators.
 */
export async function GET() {
  const running = await prisma.pipelineRun.findMany({
    where: {
      status: { in: ["running", "awaiting_plan"] },
    },
    select: {
      projectId: true,
    },
    distinct: ["projectId"],
    take: ACTIVE_PIPELINE_LIMIT,
  });

  return NextResponse.json({
    projectIds: running.map((r) => r.projectId),
  });
}
