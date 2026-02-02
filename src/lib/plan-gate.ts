/**
 * Plan confirmation gate — file-based polling.
 * Worker writes plan → UI reads it → user confirms/rejects → worker reads confirmation.
 */

import fs from "fs";
import path from "path";
import os from "os";

function getProjectDir(projectId: string): string {
  const dir = path.join(os.tmpdir(), "lilit", projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function planFilePath(projectId: string, runId: string) {
  return path.join(getProjectDir(projectId), `plan-${runId}.json`);
}

function confirmFilePath(projectId: string, runId: string) {
  return path.join(getProjectDir(projectId), `plan-confirm-${runId}.json`);
}

export interface PlanConfirmation {
  action: "confirm" | "reject" | "modify";
  notes?: string;
}

/**
 * Write plan file for UI to read.
 */
export function writePlanFile(projectId: string, runId: string, plan: unknown) {
  const data = JSON.stringify({ status: "pending", plan, createdAt: Date.now() });
  fs.writeFileSync(planFilePath(projectId, runId), data, "utf-8");
}

/**
 * Read plan file (used by API route).
 */
export function readPlanFile(projectId: string, runId: string): { status: string; plan: unknown } | null {
  const filePath = planFilePath(projectId, runId);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Write confirmation from UI.
 */
export function writeConfirmation(projectId: string, runId: string, action: string, notes?: string) {
  const data = JSON.stringify({ action, notes, confirmedAt: Date.now() });
  fs.writeFileSync(confirmFilePath(projectId, runId), data, "utf-8");
}

/**
 * Wait for user confirmation — polls filesystem.
 */
export async function waitForConfirmation(
  projectId: string,
  runId: string,
  opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    abortCheck?: () => boolean;
  }
): Promise<PlanConfirmation> {
  const timeout = opts?.timeoutMs ?? 600_000; // 10 min
  const interval = opts?.pollIntervalMs ?? 1000;
  const abortCheck = opts?.abortCheck ?? (() => false);
  const start = Date.now();
  const filePath = confirmFilePath(projectId, runId);

  return new Promise<PlanConfirmation>((resolve, reject) => {
    const check = () => {
      if (abortCheck()) {
        reject(new Error("Aborted"));
        return;
      }

      if (fs.existsSync(filePath)) {
        try {
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PlanConfirmation;
          resolve(data);
          return;
        } catch {
          // Corrupt file, keep polling
        }
      }

      if (Date.now() - start > timeout) {
        reject(new Error("Confirmation timeout"));
        return;
      }

      setTimeout(check, interval);
    };

    check();
  });
}

/**
 * Clean up plan files after use.
 */
export function cleanupPlanFiles(projectId: string, runId: string) {
  try { fs.unlinkSync(planFilePath(projectId, runId)); } catch {}
  try { fs.unlinkSync(confirmFilePath(projectId, runId)); } catch {}
}

/**
 * Find the current pending plan for a specific project.
 */
export function findPendingPlan(projectId: string): { runId: string; plan: unknown } | null {
  try {
    const dir = getProjectDir(projectId);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("plan-") && f.endsWith(".json") && !f.includes("confirm"));

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (data.status === "pending") {
          const runId = file.replace("plan-", "").replace(".json", "");
          return { runId, plan: data.plan };
        }
      } catch {
        continue;
      }
    }
  } catch {}
  return null;
}
