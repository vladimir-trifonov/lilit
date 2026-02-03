/**
 * Google Gemini adapter — prompt-only provider via @ai-sdk/google.
 * Absorbed from llm.ts runLLM().
 */

import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { GEMINI_MODELS, DEFAULT_GEMINI_MODEL } from "../models";
import { classifyError } from "../errors";
import { MAX_TOOL_CALL_STEPS } from "@/lib/constants";
import { buildVercelTools } from "../tools/transports/function-calling";
import type { ProviderAdapter, ProviderInfo, ExecutionContext, ExecutionResult } from "./types";

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  name: "Google Gemini",
  capabilities: {
    fileAccess: false,
    shellAccess: false,
    toolUse: false,
    subAgents: false,
  },
  models: [...GEMINI_MODELS],

  detect(): ProviderInfo {
    const info: ProviderInfo = {
      id: this.id,
      name: this.name,
      available: false,
      models: [...this.models],
      capabilities: { ...this.capabilities },
    };

    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      info.available = true;
    } else {
      info.reason = "GOOGLE_GENERATIVE_AI_API_KEY not set";
    }

    return info;
  },

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const model = ctx.model || DEFAULT_GEMINI_MODEL;
    const startTime = Date.now();

    try {
      // Build tool-calling options when tools are enabled
      const toolOpts = ctx.enableTools && ctx.projectId
        ? { tools: buildVercelTools(ctx.projectId), maxSteps: MAX_TOOL_CALL_STEPS }
        : {};

      const { text, usage } = await generateText({
        model: google(model),
        system: ctx.systemPrompt,
        prompt: ctx.prompt,
        maxOutputTokens: ctx.maxTokens ?? 8192,
        ...toolOpts,
      });

      const u = usage as unknown as Record<string, number> | undefined;
      const inputTokens = u?.promptTokens ?? u?.inputTokens ?? 0;
      const outputTokens = u?.completionTokens ?? u?.outputTokens ?? 0;

      return {
        output: text,
        success: true,
        durationMs: Date.now() - startTime,
        tokensUsed: { inputTokens, outputTokens },
      };
    } catch (err: unknown) {
      const e = err as { message?: string };
      const errorMsg = e.message ?? "Unknown Gemini error";

      return {
        output: `Error: ${errorMsg}`,
        success: false,
        errorKind: classifyError(errorMsg),
        durationMs: Date.now() - startTime,
      };
    }
  },
};
