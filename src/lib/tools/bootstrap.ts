/**
 * Tool bootstrap — registers built-in tools.
 */

import {
  TOOL_SEARCH_PROJECT_HISTORY,
  TOOL_LIST_TASKS,
  TOOL_GET_TASK,
  TOOL_UPDATE_TASK_STATUS,
  TOOL_GET_MESSAGES,
  TOOL_GET_STEP_OUTPUT,
  TOOL_GET_INBOX,
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
  getInbox,
  getPipelineRuns,
  getProjectInfo,
  updateProjectStack,
} from "./implementations";
import { registerTools } from "./registry";
import type { ToolEntry } from "./registry";

function wrap<P>(fn: (projectId: string, params: P) => Promise<unknown>) {
  return (projectId: string, params: Record<string, unknown>) => fn(projectId, params as P);
}

export function registerBuiltinTools(): void {
  const entries: Record<string, ToolEntry> = {
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
    get_inbox: {
      definition: TOOL_GET_INBOX,
      execute: wrap(getInbox),
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

  registerTools(entries);
}