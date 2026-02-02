/**
 * Plan confirmation gate — file-based polling.
 * Worker writes plan → UI reads it → user confirms/rejects → worker reads confirmation.
 */

import fs from "fs";
import path from "path";
import os from "os";

const PLAN_DIR = os.tmpdir();

function planFilePath(runId: string) {
  return path.join(PLAN_DIR, `lilit-plan-${runId}.json`);
}

function confirmFilePath(runId: string) {
  return path.join(PLAN_DIR, `lilit-plan-confirm-${runId}.json`);
}

export interface PlanConfirmation {
  action: "confirm" | "reject" | "modify";
  notes?: string;
}

/**
 * Write plan file for UI to read.
 */
export function writePlanFile(runId: string, plan: unknown) {
  const data = JSON.stringify({ status: "pending", plan, createdAt: Date.now() });
  fs.writeFileSync(planFilePath(runId), data, "utf-8");
}

/**
 * Read plan file (used by API route).
 */
export function readPlanFile(runId: string): { status: string; plan: unknown } | null {
  const filePath = planFilePath(runId);
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
export function writeConfirmation(runId: string, action: string, notes?: string) {
  const data = JSON.stringify({ action, notes, confirmedAt: Date.now() });
  fs.writeFileSync(confirmFilePath(runId), data, "utf-8");
}

/**
 * Wait for user confirmation — polls filesystem.
 */
export async function waitForConfirmation(
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
  const filePath = confirmFilePath(runId);

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
export function cleanupPlanFiles(runId: string) {
  try { fs.unlinkSync(planFilePath(runId)); } catch {}
  try { fs.unlinkSync(confirmFilePath(runId)); } catch {}
}

/**
 * Find the current pending plan (scan /tmp for lilit-plan-*.json).
 */
export function findPendingPlan(): { runId: string; plan: unknown } | null {
  try {
    const files = fs.readdirSync(PLAN_DIR).filter((f) => f.startsWith("lilit-plan-") && f.endsWith(".json") && !f.includes("confirm"));

    for (const file of files) {
      const filePath = path.join(PLAN_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (data.status === "pending") {
          const runId = file.replace("lilit-plan-", "").replace(".json", "");
          return { runId, plan: data.plan };
        }
      } catch {
        continue;
      }
    }
  } catch {}
  return null;
}
