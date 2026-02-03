/**
 * Function-calling transport — wraps tool definitions for SDK-based providers.
 *
 * Vercel AI SDK (Gemini): uses tool objects with jsonSchema parameters
 * Anthropic SDK (Claude API): uses tools array with input_schema
 */

import { jsonSchema, type ToolSet } from "ai";
import { getAllToolDefinitions, executeTool } from "../registry";
import type { ToolDefinition } from "../definitions";

// ── Vercel AI SDK format (for Gemini adapter) ──────────────────────────────

/**
 * Build a tools object for Vercel AI SDK's generateText().
 * Each tool includes an execute function scoped to the given projectId.
 *
 * Constructs tool objects directly (matching ToolSet shape) because
 * the tool() helper doesn't accept execute with jsonSchema parameters
 * in its TypeScript overloads, even though it works at runtime.
 */
export function buildVercelTools(projectId: string): ToolSet {
  const definitions = getAllToolDefinitions();
  const tools: ToolSet = {};

  for (const def of definitions) {
    const schema = jsonSchema(def.inputSchema as Parameters<typeof jsonSchema>[0]);
    tools[def.name] = {
      description: def.description,
      parameters: schema,
      execute: async (params: unknown) => {
        return await executeTool(def.name, projectId, (params ?? {}) as Record<string, unknown>);
      },
    } as unknown as ToolSet[string];
  }

  return tools;
}

// ── Anthropic SDK format (for Claude API adapter) ──────────────────────────

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: ToolDefinition["inputSchema"];
}

/**
 * Build a tools array for Anthropic SDK's messages.create().
 * Returns schema-only definitions; the adapter handles execution dispatch.
 */
export function buildAnthropicToolDefs(): AnthropicToolDef[] {
  return getAllToolDefinitions().map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: def.inputSchema,
  }));
}
