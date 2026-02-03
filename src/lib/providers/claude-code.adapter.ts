/**
 * Claude Code CLI adapter — file-access provider that spawns `claude -p`.
 * Extracted from claude-code.ts runClaudeCode().
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from "../models";
import { classifyError } from "../errors";
import { appendLog, isAborted } from "../claude-code";
import type { ProviderAdapter, ProviderInfo, ExecutionContext, ExecutionResult } from "./types";
import {
  CLI_TIMEOUT_MS,
  ABORT_CHECK_INTERVAL_MS,
  SIGKILL_DELAY_MS,
  PROMPT_FILE_PREFIX,
  EMPTY_MCP_FILENAME,
  LILIT_MCP_CONFIG_FILENAME,
  LOG_SEPARATOR_LENGTH,
} from "@/lib/constants";

export const claudeCodeAdapter: ProviderAdapter = {
  id: "claude-code",
  name: "Claude Code CLI",
  capabilities: {
    fileAccess: true,
    shellAccess: true,
    toolUse: true,
    subAgents: true,
  },
  models: [...CLAUDE_MODELS],

  detect(): ProviderInfo {
    const info: ProviderInfo = {
      id: this.id,
      name: this.name,
      available: false,
      models: [...this.models],
      capabilities: { ...this.capabilities },
    };

    try {
      execSync("which claude", { encoding: "utf-8", stdio: "pipe" });
      info.available = true;
    } catch {
      info.reason = "Claude Code CLI not found (run: npm install -g @anthropic-ai/claude-code)";
    }

    return info;
  },

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const {
      prompt,
      systemPrompt,
      model = DEFAULT_CLAUDE_MODEL,
      cwd = process.cwd(),
      projectId,
      timeoutMs = CLI_TIMEOUT_MS,
      agentLabel = "agent",
    } = ctx;

    if (projectId && isAborted(projectId)) {
      if (projectId) appendLog(projectId, `\n[${agentLabel}] Skipped -- pipeline aborted\n`);
      return { success: false, output: "", error: "Aborted by user", durationMs: 0 };
    }

    const startTime = Date.now();
    const tmpDir = os.tmpdir();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const promptFile = path.join(tmpDir, `${PROMPT_FILE_PREFIX}${id}.txt`);

    fs.writeFileSync(promptFile, prompt, "utf-8");
    if (projectId) {
      appendLog(projectId, `\n${"=".repeat(LOG_SEPARATOR_LENGTH)}\n[${agentLabel}] Started -- ${new Date().toLocaleTimeString()}\n${"=".repeat(LOG_SEPARATOR_LENGTH)}\n`);
    }

    // Validate model name
    const SAFE_MODEL_RE = /^[a-zA-Z0-9._:/-]+$/;
    if (!SAFE_MODEL_RE.test(model)) {
      throw new Error(`Invalid model name: ${model}`);
    }

    // Build MCP config — real tools when enabled, empty otherwise
    let mcpConfigPath: string;

    if (ctx.enableTools && projectId) {
      const mcpServerScript = path.resolve(process.cwd(), "src/lib/tools/transports/mcp-server.ts");
      const mcpConfig = {
        mcpServers: {
          "lilit-tools": {
            command: "bunx",
            args: ["tsx", mcpServerScript],
            env: {
              LILIT_PROJECT_ID: projectId,
              DATABASE_URL: process.env.DATABASE_URL ?? "",
            },
          },
        },
      };
      mcpConfigPath = path.join(tmpDir, LILIT_MCP_CONFIG_FILENAME);
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig), "utf-8");
    } else {
      mcpConfigPath = path.join(tmpDir, EMPTY_MCP_FILENAME);
      if (!fs.existsSync(mcpConfigPath)) {
        fs.writeFileSync(mcpConfigPath, '{"mcpServers":{}}', "utf-8");
      }
    }

    const args = [
      "-p", prompt,
      "--model", model,
      "--output-format", "text",
      "--verbose",
      "--dangerously-skip-permissions",
      "--mcp-config", mcpConfigPath,
      "--strict-mcp-config",
    ];

    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    if (ctx.sessionId) {
      args.push("--session-id", ctx.sessionId);
    }

    return new Promise<ExecutionResult>((resolve) => {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let killed = false;
      const proc = spawn("claude", args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdoutChunks.push(chunk);
        if (projectId) appendLog(projectId, chunk);
      });

      proc.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderrChunks.push(chunk);
        if (projectId) appendLog(projectId, `[stderr] ${chunk}`);
      });

      // Periodic abort check (every 3 seconds)
      const abortInterval = setInterval(() => {
        if (projectId && isAborted(projectId) && !killed) {
          killed = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch {}
          }, SIGKILL_DELAY_MS);
        }
      }, ABORT_CHECK_INTERVAL_MS);

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

        if (killed && projectId && isAborted(projectId)) {
          appendLog(projectId, `\n[${agentLabel}] Aborted (${duration}s)\n`);
          resolve({
            success: false,
            output: stdout.trim(),
            error: "Aborted by user",
            durationMs: Date.now() - startTime,
          });
          return;
        }

        if (code === 0) {
          const tokenMatch = stdout.match(/(\d+)in\/(\d+)out/);
          const tokensUsed = tokenMatch
            ? { inputTokens: parseInt(tokenMatch[1]), outputTokens: parseInt(tokenMatch[2]) }
            : undefined;

          if (projectId) appendLog(projectId, `\n✅ [${agentLabel}] Done (${duration}s)\n`);
          resolve({
            success: true,
            output: stdout.trim(),
            durationMs: Date.now() - startTime,
            tokensUsed,
          });
        } else {
          if (stderr && projectId) appendLog(projectId, `\nSTDERR: ${stderr}\n`);
          if (projectId) appendLog(projectId, `\n[${agentLabel}] Failed (${duration}s): exit code ${code}\n`);

          const errorStr = stderr || `Process exited with code ${code}`;
          resolve({
            success: false,
            output: stdout.trim(),
            error: errorStr,
            errorKind: classifyError(errorStr),
            durationMs: Date.now() - startTime,
          });
        }
      });

      proc.on("error", (err) => {
        clearInterval(abortInterval);
        clearTimeout(timeout);
        try { fs.unlinkSync(promptFile); } catch {}

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        if (projectId) appendLog(projectId, `\n[${agentLabel}] Spawn error (${duration}s): ${err.message}\n`);

        resolve({
          success: false,
          output: "",
          error: err.message,
          errorKind: classifyError(err.message),
          durationMs: Date.now() - startTime,
        });
      });
    });
  },
};
