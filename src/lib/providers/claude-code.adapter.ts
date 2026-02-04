/**
 * Claude Code CLI adapter — file-access provider that spawns `claude -p`.
 * Uses `--output-format stream-json` for live NDJSON streaming.
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from "../models";
import { classifyError } from "../errors";
import { appendLog, isAborted } from "../claude-code";
import type {
  ProviderAdapter,
  ProviderInfo,
  ExecutionContext,
  ExecutionResult,
  StreamEvent,
  StreamEventResult,
} from "./types";
import {
  CLI_TIMEOUT_MS,
  ABORT_CHECK_INTERVAL_MS,
  SIGKILL_DELAY_MS,
  PROMPT_FILE_PREFIX,
  EMPTY_MCP_FILENAME,
  LILIT_MCP_CONFIG_FILENAME,
  LOG_SEPARATOR_LENGTH,
  STREAM_EVENT_SYSTEM,
  STREAM_EVENT_ASSISTANT,
  STREAM_EVENT_RESULT,
  STREAM_FILTERED_SUBTYPES,
  TOOL_USE_LOG_PREFIX,
} from "@/lib/constants";

/** Format a tool_use content block into a readable one-liner for logs. */
function formatToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read": {
      const fp = input.file_path ?? input.path ?? "";
      return `Read ${fp}`;
    }
    case "Write": {
      const fp = input.file_path ?? input.path ?? "";
      return `Write ${fp}`;
    }
    case "Edit": {
      const fp = input.file_path ?? input.path ?? "";
      return `Edit ${fp}`;
    }
    case "Bash": {
      const cmd = String(input.command ?? "");
      return `Bash: ${cmd.length > 120 ? cmd.slice(0, 120) + "…" : cmd}`;
    }
    case "Glob": {
      const pattern = input.pattern ?? "";
      return `Glob ${pattern}`;
    }
    case "Grep": {
      const pattern = input.pattern ?? "";
      return `Grep ${pattern}`;
    }
    default:
      return name;
  }
}

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
      cwd,
      projectId,
      timeoutMs = CLI_TIMEOUT_MS,
      agentLabel = "agent",
    } = ctx;

    if (!cwd) {
      throw new Error("Claude Code adapter requires an explicit cwd");
    }

    if (projectId && isAborted(projectId)) {
      appendLog(projectId, `\n[${agentLabel}] Skipped -- pipeline aborted\n`);
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
      "--output-format", "stream-json",
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
      const outputParts: string[] = [];
      const stderrChunks: string[] = [];
      let lineBuf = "";
      let resultEvent: StreamEventResult | undefined;
      let killed = false;

      const proc = spawn("claude", args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      /** Process a single NDJSON line from stdout. */
      function processStreamLine(line: string): void {
        let event: StreamEvent;
        try {
          event = JSON.parse(line) as StreamEvent;
        } catch {
          // Not valid JSON — log as raw text fallback
          if (projectId) appendLog(projectId, line + "\n");
          return;
        }

        // Fire optional callback
        ctx.onStreamEvent?.(event);

        switch (event.type) {
          case STREAM_EVENT_SYSTEM: {
            if (STREAM_FILTERED_SUBTYPES.has(event.subtype)) break;
            // Log notable system events (e.g. init) at debug level
            if (projectId && event.subtype === "init") {
              appendLog(projectId, `[system] session initialized\n`);
            }
            break;
          }

          case STREAM_EVENT_ASSISTANT: {
            const content = event.message?.content;
            if (!Array.isArray(content)) break;

            for (const block of content) {
              if (block.type === "text" && block.text) {
                outputParts.push(block.text);
                if (projectId) appendLog(projectId, block.text);
              } else if (block.type === "tool_use") {
                const desc = formatToolUse(block.name, block.input);
                if (projectId) {
                  appendLog(projectId, `\n${TOOL_USE_LOG_PREFIX} ${desc}\n`);
                }
              }
            }
            break;
          }

          // tool results can be huge — skip logging them
          case STREAM_EVENT_RESULT: {
            resultEvent = event as StreamEventResult;
            break;
          }

          // default covers "tool" and any unknown types — ignore
          default:
            break;
        }
      }

      proc.stdout.on("data", (data: Buffer) => {
        lineBuf += data.toString();
        const lines = lineBuf.split("\n");
        // Last element is either empty (complete line) or a partial fragment
        lineBuf = lines.pop()!;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) processStreamLine(trimmed);
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderrChunks.push(chunk);
        if (projectId) appendLog(projectId, `[stderr] ${chunk}`);
      });

      // Periodic abort check
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

        // Flush any remaining partial line
        if (lineBuf.trim()) {
          processStreamLine(lineBuf.trim());
          lineBuf = "";
        }

        const output = outputParts.join("");
        const stderr = stderrChunks.join("");
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (killed && projectId && isAborted(projectId)) {
          appendLog(projectId, `\n[${agentLabel}] Aborted (${duration}s)\n`);
          resolve({
            success: false,
            output: output.trim(),
            error: "Aborted by user",
            durationMs: Date.now() - startTime,
          });
          return;
        }

        // Extract tokens from the structured result event
        const tokensUsed = resultEvent?.usage
          ? {
              inputTokens: (resultEvent.usage.input_tokens ?? 0)
                + (resultEvent.usage.cache_creation_input_tokens ?? 0)
                + (resultEvent.usage.cache_read_input_tokens ?? 0),
              outputTokens: resultEvent.usage.output_tokens ?? 0,
            }
          : undefined;

        if (code === 0) {
          if (projectId) appendLog(projectId, `\n✅ [${agentLabel}] Done (${duration}s)\n`);
          resolve({
            success: true,
            output: output.trim(),
            durationMs: Date.now() - startTime,
            tokensUsed,
          });
        } else {
          if (stderr && projectId) appendLog(projectId, `\nSTDERR: ${stderr}\n`);
          if (projectId) appendLog(projectId, `\n[${agentLabel}] Failed (${duration}s): exit code ${code}\n`);

          const errorStr = resultEvent?.is_error
            ? (resultEvent.result ?? `Process exited with code ${code}`)
            : (stderr || `Process exited with code ${code}`);
          resolve({
            success: false,
            output: output.trim(),
            error: errorStr,
            errorKind: classifyError(errorStr),
            durationMs: Date.now() - startTime,
            tokensUsed,
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
