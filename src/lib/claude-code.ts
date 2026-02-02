import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export interface ClaudeCodeResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  tokensUsed?: { inputTokens: number; outputTokens: number };
}

// Shared log file for live UI polling
const LOG_FILE = path.join(os.tmpdir(), "crew-live.log");
const ABORT_FILE = path.join(os.tmpdir(), "crew-abort.flag");
const PID_FILE = path.join(os.tmpdir(), "crew-worker.pid");

export function getLogFile() { return LOG_FILE; }
export function getAbortFile() { return ABORT_FILE; }
export function getPidFile() { return PID_FILE; }

export function clearLog() {
  try { fs.writeFileSync(LOG_FILE, "", "utf-8"); } catch {}
}

function appendLog(text: string) {
  try { fs.appendFileSync(LOG_FILE, text); } catch {}
}

// File-based abort system (works across processes)
export function abortActiveProcess() {
  try {
    fs.writeFileSync(ABORT_FILE, Date.now().toString(), "utf-8");

    // Try to kill the worker process
    try {
      const pid = fs.readFileSync(PID_FILE, "utf-8").trim();
      if (pid) {
        const { execSync } = require("child_process");
        // Kill the worker process tree
        execSync(`kill -TERM ${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`);
        // Also kill any Claude processes
        execSync("pkill -f 'claude -p' 2>/dev/null || true");
      }
    } catch {}

    return true;
  } catch {
    return false;
  }
}

export function isAborted(): boolean {
  try {
    return fs.existsSync(ABORT_FILE);
  } catch {
    return false;
  }
}

export function resetAbort() {
  try {
    if (fs.existsSync(ABORT_FILE)) {
      fs.unlinkSync(ABORT_FILE);
    }
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

export function setWorkerPid(pid: number) {
  try {
    fs.writeFileSync(PID_FILE, pid.toString(), "utf-8");
  } catch {}
}

/**
 * Run Claude Code CLI with execSync (spawn hangs from Node.js context).
 * Writes output to log file for live UI polling.
 */
export async function runClaudeCode(opts: {
  prompt: string;
  cwd: string;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
  agentLabel?: string;
}): Promise<ClaudeCodeResult> {
  const {
    prompt,
    cwd,
    model = "sonnet",
    systemPrompt,
    timeoutMs = 1_800_000,
    agentLabel = "agent",
  } = opts;

  if (isAborted()) {
    appendLog(`\n🛑 [${agentLabel}] Skipped — pipeline aborted\n`);
    return { success: false, output: "", error: "Aborted by user", durationMs: 0, tokensUsed: undefined };
  }

  const startTime = Date.now();
  const tmpDir = os.tmpdir();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const promptFile = path.join(tmpDir, `crew-prompt-${id}.txt`);
  const sysFile = path.join(tmpDir, `crew-sys-${id}.txt`);

  fs.writeFileSync(promptFile, prompt, "utf-8");
  appendLog(`\n${"=".repeat(60)}\n🚀 [${agentLabel}] Started — ${new Date().toLocaleTimeString()}\n${"=".repeat(60)}\n`);

  try {
    // Build command — use $ENV_VAR instead of $(cat file) to avoid
    // shell expansion of backticks/$ in prompt content (PM plans have JSON code fences)
    const emptyMcp = path.join(tmpDir, "crew-mcp-empty.json");
    if (!fs.existsSync(emptyMcp)) {
      fs.writeFileSync(emptyMcp, '{"mcpServers":{}}', "utf-8");
    }

    let cmd = `claude -p "$CREW_PROMPT" --model ${model} --output-format text --permission-mode bypassPermissions --mcp-config '${emptyMcp}' --strict-mcp-config`;

    const execEnv = {
      ...process.env,
      CREW_PROMPT: prompt,
    } as NodeJS.ProcessEnv;

    if (systemPrompt) {
      cmd += ` --system-prompt "$CREW_SYS_PROMPT"`;
      (execEnv as Record<string, string>).CREW_SYS_PROMPT = systemPrompt;
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
    appendLog(`\n${output}\n`);

    // Parse token usage from output (Claude Code CLI reports this)
    const tokenMatch = output.match(/(\d+)in\/(\d+)out/);
    const tokensUsed = tokenMatch
      ? {
          inputTokens: parseInt(tokenMatch[1]),
          outputTokens: parseInt(tokenMatch[2]),
        }
      : undefined;

    appendLog(`\n✅ [${agentLabel}] Done (${duration}s)\n`);

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

    if (stdout) appendLog(`\n${stdout}\n`);
    if (stderr) appendLog(`\n⚠️ STDERR: ${stderr}\n`);
    appendLog(`\n❌ [${agentLabel}] Failed (${duration}s): ${e.message?.slice(0, 200)}\n`);

    return {
      success: false,
      output: stdout,
      error: stderr || e.message || "Unknown error",
      durationMs: Date.now() - startTime,
      tokensUsed: undefined,
    };
  } finally {
    try { fs.unlinkSync(promptFile); } catch {}
    try { fs.unlinkSync(sysFile); } catch {}
  }
}
