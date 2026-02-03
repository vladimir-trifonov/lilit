/**
 * Tool registry — maps tool names to their schema + implementation.
 * Provider-agnostic: transports import from here to build native tool lists.
 */

import type { ToolDefinition } from "./definitions";
import {
  TOOL_SEARCH_PROJECT_HISTORY,
  TOOL_LIST_TASKS,
  TOOL_GET_TASK,
  TOOL_UPDATE_TASK_STATUS,
  TOOL_GET_MESSAGES,
  TOOL_GET_STEP_OUTPUT,
  TOOL_GET_PIPELINE_RUNS,
  TOOL_GET_PROJECT_INFO,
  TOOL_UPDATE_PROJECT_STACK,
} from "./definitions";
import {
  searchProjectHistory,
  listTasks,
  getTask,
  updateTaskStatus,
  getMessages,
  getStepOutput,
  getPipelineRuns,
  getProjectInfo,
  updateProjectStack,
} from "./implementations";

export type ToolExecuteFn = (projectId: string, params: Record<string, unknown>) => Promise<unknown>;

export interface ToolEntry {
  definition: ToolDefinition;
  execute: ToolExecuteFn;
}

// Wrap typed implementations to accept Record<string, unknown> params
function wrap<P>(fn: (projectId: string, params: P) => Promise<unknown>): ToolExecuteFn {
  return (projectId, params) => fn(projectId, params as P);
}

/** Complete tool registry */
export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  search_project_history: {
    definition: TOOL_SEARCH_PROJECT_HISTORY,
    execute: wrap(searchProjectHistory),
  },
  list_tasks: {
    definition: TOOL_LIST_TASKS,
    execute: wrap(listTasks),
  },
  get_task: {
    definition: TOOL_GET_TASK,
    execute: wrap(getTask),
  },
  update_task_status: {
    definition: TOOL_UPDATE_TASK_STATUS,
    execute: wrap(updateTaskStatus),
  },
  get_messages: {
    definition: TOOL_GET_MESSAGES,
    execute: wrap(getMessages),
  },
  get_step_output: {
    definition: TOOL_GET_STEP_OUTPUT,
    execute: wrap(getStepOutput),
  },
  get_pipeline_runs: {
    definition: TOOL_GET_PIPELINE_RUNS,
    execute: wrap(getPipelineRuns),
  },
  get_project_info: {
    definition: TOOL_GET_PROJECT_INFO,
    execute: wrap(getProjectInfo),
  },
  update_project_stack: {
    definition: TOOL_UPDATE_PROJECT_STACK,
    execute: wrap(updateProjectStack),
  },
};

/** Execute a tool by name. Returns the result or an error object. */
export async function executeTool(
  name: string,
  projectId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
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
  return Object.values(TOOL_REGISTRY).map((e) => e.definition);
}
