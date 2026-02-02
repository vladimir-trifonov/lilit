import { execSync } from "child_process";
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
 * Run Claude Code CLI with execSync (spawn hangs from Node.js context).
 * Writes output to log file for live UI polling.
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

  try {
    // Build command — use $ENV_VAR instead of $(cat file) to avoid
    // shell expansion of backticks/$ in prompt content (PM plans have JSON code fences)
    const emptyMcp = path.join(tmpDir, "lilit-mcp-empty.json");
    if (!fs.existsSync(emptyMcp)) {
      fs.writeFileSync(emptyMcp, '{"mcpServers":{}}', "utf-8");
    }

    let cmd = `claude -p "$LILIT_PROMPT" --model "${model}" --output-format text --permission-mode bypassPermissions --mcp-config '${emptyMcp}' --strict-mcp-config`;

    const execEnv = {
      ...process.env,
      LILIT_PROMPT: prompt,
    } as NodeJS.ProcessEnv;

    if (systemPrompt) {
      cmd += ` --system-prompt "$LILIT_SYS_PROMPT"`;
      (execEnv as Record<string, string>).LILIT_SYS_PROMPT = systemPrompt;
    }

    const output = execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
      shell: "/bin/bash",
      env: execEnv,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    appendLog(projectId, `\n${output}\n`);

    // Parse token usage from output (Claude Code CLI reports this)
    const tokenMatch = output.match(/(\d+)in\/(\d+)out/);
    const tokensUsed = tokenMatch
      ? {
          inputTokens: parseInt(tokenMatch[1]),
          outputTokens: parseInt(tokenMatch[2]),
        }
      : undefined;

    appendLog(projectId, `\n✅ [${agentLabel}] Done (${duration}s)\n`);

    return {
      success: true,
      output: output.trim(),
      durationMs: Date.now() - startTime,
      tokensUsed,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const stdout = e.stdout?.toString?.()?.trim() || "";
    const stderr = e.stderr?.toString?.()?.trim() || "";
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (stdout) appendLog(projectId, `\n${stdout}\n`);
    if (stderr) appendLog(projectId, `\n⚠️ STDERR: ${stderr}\n`);
    appendLog(projectId, `\n❌ [${agentLabel}] Failed (${duration}s): ${e.message?.slice(0, 200)}\n`);

    const errorStr = stderr || e.message || "Unknown error";
    return {
      success: false,
      output: stdout,
      error: errorStr,
      errorKind: classifyError(errorStr),
      durationMs: Date.now() - startTime,
      tokensUsed: undefined,
    };
  } finally {
    try { fs.unlinkSync(promptFile); } catch {}
  }
}
