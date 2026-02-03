/**
 * Anthropic API adapter — prompt-only provider via @anthropic-ai/sdk.
 * Uses dynamic import so the SDK is only loaded when actually needed.
 */

import { CLAUDE_API_MODELS, DEFAULT_CLAUDE_API_MODEL } from "../models";
import { classifyError } from "../errors";
import { MAX_TOOL_CALL_STEPS } from "@/lib/constants";
import { buildAnthropicToolDefs } from "../tools/transports/function-calling";
import { executeTool } from "../tools/registry";
import type { ProviderAdapter, ProviderInfo, ExecutionContext, ExecutionResult } from "./types";

// Local types for the Anthropic SDK message API (avoids referencing dynamic import namespace)
interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export const claudeApiAdapter: ProviderAdapter = {
  id: "claude-api",
  name: "Anthropic API",
  capabilities: {
    fileAccess: false,
    shellAccess: false,
    toolUse: false,
    subAgents: false,
  },
  models: [...CLAUDE_API_MODELS],

  detect(): ProviderInfo {
    const info: ProviderInfo = {
      id: this.id,
      name: this.name,
      available: false,
      models: [...this.models],
      capabilities: { ...this.capabilities },
    };

    if (process.env.ANTHROPIC_API_KEY) {
      info.available = true;
    } else {
      info.reason = "ANTHROPIC_API_KEY not set";
    }

    return info;
  },

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const model = ctx.model || DEFAULT_CLAUDE_API_MODEL;
    const startTime = Date.now();
    const useTools = ctx.enableTools && ctx.projectId;

    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();

      const toolDefs = useTools ? buildAnthropicToolDefs() : undefined;

      // Use SDK-agnostic message array — cast at the API call boundary
      const messages: Array<{ role: string; content: unknown }> = [
        { role: "user", content: ctx.prompt },
      ];
      let totalInput = 0;
      let totalOutput = 0;

      // Tool-calling loop: repeat until model produces a final text response
      for (let step = 0; step < (useTools ? MAX_TOOL_CALL_STEPS : 1); step++) {
        const createParams: Record<string, unknown> = {
          model,
          max_tokens: ctx.maxTokens ?? 8192,
          system: ctx.systemPrompt,
          messages,
        };
        if (toolDefs) {
          createParams.tools = toolDefs;
        }

        // Cast through unknown to avoid union type issues with streaming overload
        const response = await (client.messages.create as (p: unknown) => Promise<{
          content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
          usage?: { input_tokens: number; output_tokens: number };
          stop_reason: string | null;
        }>)(createParams);

        totalInput += response.usage?.input_tokens ?? 0;
        totalOutput += response.usage?.output_tokens ?? 0;

        // Check if the model wants to call tools
        const toolUseBlocks = response.content.filter(
          (b): b is ToolUseContent => b.type === "tool_use",
        ) as ToolUseContent[];

        if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
          // Final response — extract text
          const text = response.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { type: string; text?: string }) => b.text ?? "")
            .join("");

          return {
            output: text,
            success: true,
            durationMs: Date.now() - startTime,
            tokensUsed: { inputTokens: totalInput, outputTokens: totalOutput },
          };
        }

        // Execute tool calls and feed results back
        messages.push({ role: "assistant", content: response.content });

        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
        for (const toolCall of toolUseBlocks) {
          const result = await executeTool(
            toolCall.name,
            ctx.projectId!,
            toolCall.input,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }

        messages.push({ role: "user", content: toolResults });
      }

      // If we exhausted steps, return whatever we have
      return {
        output: "Tool calling exceeded maximum steps",
        success: false,
        durationMs: Date.now() - startTime,
        tokensUsed: { inputTokens: totalInput, outputTokens: totalOutput },
      };
    } catch (err: unknown) {
      const e = err as { message?: string };
      const errorMsg = e.message ?? "Unknown Anthropic API error";

      return {
        output: `Error: ${errorMsg}`,
        success: false,
        errorKind: classifyError(errorMsg),
        durationMs: Date.now() - startTime,
      };
    }
  },
};
