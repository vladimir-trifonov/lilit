/**
 * Claude Code infrastructure helpers — logging, abort, PID management.
 * The actual CLI execution logic lives in providers/claude-code.adapter.ts.
 */

import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { TEMP_DIR_NAME, LOG_FILENAME, ABORT_FILENAME, PID_FILENAME } from "@/lib/constants";

const VALID_PROJECT_ID = /^[a-zA-Z0-9_-]+$/;

// Per-project directory for isolation
export function getProjectDir(projectId: string): string {
  if (!VALID_PROJECT_ID.test(projectId)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }
  const dir = path.join(os.tmpdir(), TEMP_DIR_NAME, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogFile(projectId: string) { return path.join(getProjectDir(projectId), LOG_FILENAME); }
export function getAbortFile(projectId: string) { return path.join(getProjectDir(projectId), ABORT_FILENAME); }
export function getPidFile(projectId: string) { return path.join(getProjectDir(projectId), PID_FILENAME); }

export function clearLog(projectId: string) {
  try { fs.writeFileSync(getLogFile(projectId), "", "utf-8"); } catch {}
}

export function appendLog(projectId: string, text: string) {
  try { fs.appendFileSync(getLogFile(projectId), text); } catch {}
}

// File-based abort system (works across processes)
export function abortActiveProcess(projectId: string) {
  try {
    fs.writeFileSync(getAbortFile(projectId), Date.now().toString(), "utf-8");

    // Try to kill the worker process
    try {
      const pidStr = fs.readFileSync(getPidFile(projectId), "utf-8").trim();
      const pid = parseInt(pidStr, 10);
      if (!Number.isNaN(pid) && pid > 0) {
        try { process.kill(pid, "SIGTERM"); } catch {}
        // Also kill child processes
        execSync(`pkill -P ${pid} 2>/dev/null || true`);
      }
    } catch {}

    return true;
  } catch {
    return false;
  }
}

export function isAborted(projectId: string): boolean {
  try {
    return fs.existsSync(getAbortFile(projectId));
  } catch {
    return false;
  }
}

export function resetAbort(projectId: string) {
  try {
    const abortFile = getAbortFile(projectId);
    if (fs.existsSync(abortFile)) {
      fs.unlinkSync(abortFile);
    }
    const pidFile = getPidFile(projectId);
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {}
}

export function setWorkerPid(projectId: string, pid: number) {
  try {
    fs.writeFileSync(getPidFile(projectId), pid.toString(), "utf-8");
  } catch {}
}
