/**
 * LLM wrapper — used for agents that don't need tools (PM, Architect, Summary).
 * Uses Google Gemini via @ai-sdk/google (Antigravity / Google AI Studio).
 */

import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import fs from "fs";
import os from "os";
import path from "path";

// Share the same log file as claude-code.ts for unified live UI
const LOG_FILE = path.join(os.tmpdir(), "lilit-live.log");

function appendLog(text: string) {
  try { fs.appendFileSync(LOG_FILE, text); } catch {}
}

export async function runLLM(opts: {
  prompt: string;
  systemPrompt: string;
  model?: string;
  maxTokens?: number;
  agentLabel?: string;
}): Promise<{
  text: string;
  success: boolean;
  durationMs: number;
  tokensUsed?: { inputTokens: number; outputTokens: number };
}> {
  const model = opts.model ?? "gemini-2.5-flash";
  const label = opts.agentLabel ?? "gemini";
  const startTime = Date.now();

  appendLog(`\n${"=".repeat(60)}\n🤖 [${label}] Started (Gemini: ${model}) — ${new Date().toLocaleTimeString()}\n${"=".repeat(60)}\n`);

  try {
    const { text, usage } = await generateText({
      model: google(model),
      system: opts.systemPrompt,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxTokens ?? 8192,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const u = usage as unknown as Record<string, number> | undefined;
    const inputTokens = u?.promptTokens ?? u?.inputTokens ?? 0;
    const outputTokens = u?.completionTokens ?? u?.outputTokens ?? 0;
    const tokens = `${inputTokens}in/${outputTokens}out`;
    appendLog(`\n${text}\n`);
    appendLog(`\n✅ [${label}] Done (${duration}s, ${tokens} tokens)\n`);

    return {
      text,
      success: true,
      durationMs: Date.now() - startTime,
      tokensUsed: {
        inputTokens,
        outputTokens,
      },
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    appendLog(`\n❌ [${label}] Gemini error (${duration}s): ${e.message?.slice(0, 500)}\n`);

    return {
      text: `Error: ${e.message ?? "Unknown Gemini error"}`,
      success: false,
      durationMs: Date.now() - startTime,
      tokensUsed: undefined,
    };
  }
}
