import { spawn, execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_CLAUDE_MODEL } from "./providers";
import { classifyError, type ErrorKind } from "./errors";

export interface ClaudeCodeResult {
  success: boolean;
  output: string;
  error?: string;
  errorKind?: ErrorKind;
  durationMs: number;
  tokensUsed?: { inputTokens: number; outputTokens: number };
}

// Per-project directory for isolation
function getProjectDir(projectId: string): string {
  const dir = path.join(os.tmpdir(), "lilit", projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogFile(projectId: string) { return path.join(getProjectDir(projectId), "live.log"); }
export function getAbortFile(projectId: string) { return path.join(getProjectDir(projectId), "abort.flag"); }
export function getPidFile(projectId: string) { return path.join(getProjectDir(projectId), "worker.pid"); }

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
      const pid = fs.readFileSync(getPidFile(projectId), "utf-8").trim();
      if (pid) {
        // Kill the worker process tree — use pkill -P to only kill children of this worker
        execSync(`kill -TERM ${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`);
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

/**
 * Run Claude Code CLI using async spawn (non-blocking).
 * Writes output to log file for live UI polling.
 * Supports mid-execution abort checking and concurrent execution.
 */
export async function runClaudeCode(opts: {
  prompt: string;
  cwd: string;
  projectId: string;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
  agentLabel?: string;
}): Promise<ClaudeCodeResult> {
  const {
    prompt,
    cwd,
    projectId,
    model = DEFAULT_CLAUDE_MODEL,
    systemPrompt,
    timeoutMs = 1_800_000,
    agentLabel = "agent",
  } = opts;

  if (isAborted(projectId)) {
    appendLog(projectId, `\n🛑 [${agentLabel}] Skipped — pipeline aborted\n`);
    return { success: false, output: "", error: "Aborted by user", durationMs: 0, tokensUsed: undefined };
  }

  const startTime = Date.now();
  const tmpDir = os.tmpdir();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const promptFile = path.join(tmpDir, `lilit-prompt-${id}.txt`);

  fs.writeFileSync(promptFile, prompt, "utf-8");
  appendLog(projectId, `\n${"=".repeat(60)}\n🚀 [${agentLabel}] Started — ${new Date().toLocaleTimeString()}\n${"=".repeat(60)}\n`);

  // Validate model name — alphanumeric, dots, dashes, colons, slashes only
  const SAFE_MODEL_RE = /^[a-zA-Z0-9._:/-]+$/;
  if (!SAFE_MODEL_RE.test(model)) {
    throw new Error(`Invalid model name: ${model}`);
  }

  // Build command args for spawn
  const emptyMcp = path.join(tmpDir, "lilit-mcp-empty.json");
  if (!fs.existsSync(emptyMcp)) {
    fs.writeFileSync(emptyMcp, '{"mcpServers":{}}', "utf-8");
  }

  const args = [
    "-p", prompt,
    "--model", model,
    "--output-format", "text",
    "--permission-mode", "bypassPermissions",
    "--mcp-config", emptyMcp,
    "--strict-mcp-config",
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  return new Promise<ClaudeCodeResult>((resolve) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let killed = false;

    const proc = spawn("claude", args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdoutChunks.push(chunk);
      appendLog(projectId, chunk);
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderrChunks.push(data.toString());
    });

    // Periodic abort check (every 3 seconds)
    const abortInterval = setInterval(() => {
      if (isAborted(projectId) && !killed) {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
        }, 5000);
      }
    }, 3000);

    // Timeout
    const timeout = setTimeout(() => {
      if (!killed) {
        killed = true;
        proc.kill("SIGKILL");
      }
    }, timeoutMs);

    proc.on("close", (code) => {
      clearInterval(abortInterval);
      clearTimeout(timeout);
      try { fs.unlinkSync(promptFile); } catch {}

      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      if (killed && isAborted(projectId)) {
        appendLog(projectId, `\n🛑 [${agentLabel}] Aborted (${duration}s)\n`);
        resolve({
          success: false,
          output: stdout.trim(),
          error: "Aborted by user",
          durationMs: Date.now() - startTime,
          tokensUsed: undefined,
        });
        return;
      }

      if (code === 0) {
        // Parse token usage from output
        const tokenMatch = stdout.match(/(\d+)in\/(\d+)out/);
        const tokensUsed = tokenMatch
          ? { inputTokens: parseInt(tokenMatch[1]), outputTokens: parseInt(tokenMatch[2]) }
          : undefined;

        appendLog(projectId, `\n✅ [${agentLabel}] Done (${duration}s)\n`);
        resolve({
          success: true,
          output: stdout.trim(),
          durationMs: Date.now() - startTime,
          tokensUsed,
        });
      } else {
        if (stderr) appendLog(projectId, `\n⚠️ STDERR: ${stderr}\n`);
        appendLog(projectId, `\n❌ [${agentLabel}] Failed (${duration}s): exit code ${code}\n`);

        const errorStr = stderr || `Process exited with code ${code}`;
        resolve({
          success: false,
          output: stdout.trim(),
          error: errorStr,
          errorKind: classifyError(errorStr),
          durationMs: Date.now() - startTime,
          tokensUsed: undefined,
        });
      }
    });

    proc.on("error", (err) => {
      clearInterval(abortInterval);
      clearTimeout(timeout);
      try { fs.unlinkSync(promptFile); } catch {}

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      appendLog(projectId, `\n❌ [${agentLabel}] Spawn error (${duration}s): ${err.message}\n`);

      resolve({
        success: false,
        output: "",
        error: err.message,
        errorKind: classifyError(err.message),
        durationMs: Date.now() - startTime,
        tokensUsed: undefined,
      });
    });
  });
}
