/**
 * Tool registry — maps tool names to their schema + implementation.
 * Provider-agnostic: transports import from here to build native tool lists.
 */

import type { ToolDefinition } from "./definitions";
import { registerBuiltinTools } from "./bootstrap";

export type ToolExecuteFn = (projectId: string, params: Record<string, unknown>) => Promise<unknown>;

export interface ToolEntry {
  definition: ToolDefinition;
  execute: ToolExecuteFn;
}

const TOOL_REGISTRY: Record<string, ToolEntry> = {};
let builtinsRegistered = false;

export function registerTool(name: string, entry: ToolEntry): void {
  if (TOOL_REGISTRY[name]) return;
  TOOL_REGISTRY[name] = entry;
}

export function registerTools(entries: Record<string, ToolEntry>): void {
  for (const [name, entry] of Object.entries(entries)) {
    registerTool(name, entry);
  }
}

function ensureToolsRegistered(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  registerBuiltinTools();
}

/** Execute a tool by name. Returns the result or an error object. */
export async function executeTool(
  name: string,
  projectId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  ensureToolsRegistered();
  const entry = TOOL_REGISTRY[name];
  if (!entry) {
    return { error: `Unknown tool: ${name}` };
  }
  try {
    return await entry.execute(projectId, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Tool execution failed: ${msg}` };
  }
}

/** Get all tool definitions (for listing in transports). */
export function getAllToolDefinitions(): ToolDefinition[] {
  ensureToolsRegistered();
  return Object.values(TOOL_REGISTRY).map((e) => e.definition);
}
