/**
 * Orphan cleanup — detects and marks stale "running" PipelineRuns on startup.
 *
 * Runs once per server lifetime (lazy, triggered from the pipeline GET route).
 * Checks PID liveness and heartbeat age to avoid false positives during
 * legitimate worker startup.
 */

import fs from "fs";
import { prisma } from "@/lib/prisma";
import { getPidFile } from "@/lib/claude-code";
import { PIPELINE_STALE_THRESHOLD_MS, PIPELINE_DEAD_PID_THRESHOLD_MS } from "@/lib/constants";

let cleanupDone = false;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readWorkerPid(projectId: string): number | null {
  try {
    const pidStr = fs.readFileSync(getPidFile(projectId), "utf-8").trim();
    const pid = parseInt(pidStr, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function cleanupOrphanedRuns(): Promise<void> {
  if (cleanupDone) return;
  cleanupDone = true;

  try {
    const staleRuns = await prisma.pipelineRun.findMany({
      where: { status: { in: ["running", "awaiting_plan"] } },
      select: { id: true, runId: true, projectId: true, heartbeatAt: true, updatedAt: true },
      take: 100,
    });

    const now = Date.now();

    for (const run of staleRuns) {
      const pid = readWorkerPid(run.projectId);
      const pidAlive = pid !== null && isProcessAlive(pid);

      if (pidAlive) continue;

      const lastSignal = run.heartbeatAt ?? run.updatedAt;
      const age = now - lastSignal.getTime();

      // PID confirmed dead: use shorter threshold
      // No PID file: use the full stale threshold
      const threshold = pid !== null
        ? PIPELINE_DEAD_PID_THRESHOLD_MS
        : PIPELINE_STALE_THRESHOLD_MS;

      if (age > threshold) {
        await prisma.pipelineRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            error: `Worker process died (no heartbeat for ${Math.round(age / 1000)}s). Cleaned up on server startup.`,
          },
        });
      }
    }
  } catch {
    // Non-critical — if cleanup fails, per-request stale detection still works
  }
}
