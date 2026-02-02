/**
 * LLM wrapper — used for agents that don't need tools (PM, Architect, Summary).
 * Uses Google Gemini via @ai-sdk/google (Antigravity / Google AI Studio).
 *
 * Note: logging is handled by the orchestrator's project-scoped appendLog,
 * not here — this module is provider-agnostic and doesn't know the projectId.
 */

import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { DEFAULT_GEMINI_MODEL } from "./providers";
import { classifyError, type ErrorKind } from "./errors";

export async function runLLM(opts: {
  prompt: string;
  systemPrompt: string;
  model?: string;
  maxTokens?: number;
  agentLabel?: string;
}): Promise<{
  text: string;
  success: boolean;
  errorKind?: ErrorKind;
  durationMs: number;
  tokensUsed?: { inputTokens: number; outputTokens: number };
}> {
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const startTime = Date.now();

  try {
    const { text, usage } = await generateText({
      model: google(model),
      system: opts.systemPrompt,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxTokens ?? 8192,
    });

    const u = usage as unknown as Record<string, number> | undefined;
    const inputTokens = u?.promptTokens ?? u?.inputTokens ?? 0;
    const outputTokens = u?.completionTokens ?? u?.outputTokens ?? 0;

    return {
      text,
      success: true,
      durationMs: Date.now() - startTime,
      tokensUsed: { inputTokens, outputTokens },
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    const errorMsg = e.message ?? "Unknown Gemini error";

    return {
      text: `Error: ${errorMsg}`,
      success: false,
      errorKind: classifyError(errorMsg),
      durationMs: Date.now() - startTime,
      tokensUsed: undefined,
    };
  }
}
