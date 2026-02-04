/**
 * Tool definitions — JSON Schema descriptions for all agent data tools.
 * These are provider-agnostic: each transport layer wraps them
 * in its native format (MCP, Vercel AI SDK, Anthropic SDK).
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_SEARCH_PROJECT_HISTORY: ToolDefinition = {
  name: "search_project_history",
  description:
    "Search across the project's conversation messages, event logs, and memories. " +
    "Use this to find past decisions, features built, architectural choices, or any historical context. " +
    "Returns matching records with relevance scores.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language search query (e.g. 'authentication implementation', 'why did we choose JWT')",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 10)",
      },
      source: {
        type: "string",
        enum: ["all", "messages", "events", "memories"],
        description: "Filter by source type (default: 'all')",
      },
    },
    required: ["query"],
  },
};

export const TOOL_LIST_TASKS: ToolDefinition = {
  name: "list_tasks",
  description:
    "List tasks in the project, optionally filtered by status or pipeline run. " +
    "Returns task id, title, status, assigned agent, and cost.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["created", "assigned", "in_progress", "done", "failed", "blocked"],
        description: "Filter by task status",
      },
      pipelineRunId: {
        type: "string",
        description: "Filter by pipeline run ID (the external runId string)",
      },
      limit: {
        type: "number",
        description: "Maximum number of tasks to return (default: 20)",
      },
    },
    required: [],
  },
};

export const TOOL_GET_TASK: ToolDefinition = {
  name: "get_task",
  description:
    "Get full details of a specific task including description, acceptance criteria, " +
    "output, notes, and sub-tasks.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: 'The task ID — either a graph ID like "t1", "t2" or a DB cuid',
      },
    },
    required: ["taskId"],
  },
};

export const TOOL_UPDATE_TASK_STATUS: ToolDefinition = {
  name: "update_task_status",
  description:
    "Update a task's status and optionally add a note. " +
    "Use this to mark tasks as in_progress, done, failed, or blocked.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "The task ID to update",
      },
      status: {
        type: "string",
        enum: ["in_progress", "done", "failed", "blocked"],
        description: "New status for the task",
      },
      note: {
        type: "string",
        description: "Optional note to add (e.g. reason for failure, summary of work done)",
      },
    },
    required: ["taskId", "status"],
  },
};

export const TOOL_GET_MESSAGES: ToolDefinition = {
  name: "get_messages",
  description:
    "Get recent conversation messages from the project's chat history. " +
    "You decide how many messages you need — use a small count for recent context, " +
    "larger count for deep history.",
  inputSchema: {
    type: "object",
    properties: {
      count: {
        type: "number",
        description: "Number of recent messages to retrieve (default: 10)",
      },
      conversationId: {
        type: "string",
        description: "Specific conversation ID. If omitted, uses the most recent conversation.",
      },
    },
    required: [],
  },
};

export const TOOL_GET_STEP_OUTPUT: ToolDefinition = {
  name: "get_step_output",
  description:
    "Get the full output of a completed task/step. Use this when you need to see " +
    "exactly what a previous agent produced (code, review comments, test results, etc.).",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: 'The task ID — either a graph ID like "t1", "t2" or a DB cuid',
      },
    },
    required: ["taskId"],
  },
};

export const TOOL_GET_PIPELINE_RUNS: ToolDefinition = {
  name: "get_pipeline_runs",
  description:
    "List past pipeline runs for the project. Shows run status, task count, " +
    "cost, and timing. Use this to understand the project's execution history.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of runs to return (default: 10)",
      },
      status: {
        type: "string",
        enum: ["running", "awaiting_plan", "completed", "failed", "aborted"],
        description: "Filter by run status",
      },
    },
    required: [],
  },
};

export const TOOL_GET_INBOX: ToolDefinition = {
  name: "get_inbox",
  description:
    "Get messages sent to you by other agents during the current pipeline run. " +
    "Returns questions, flags, suggestions, handoffs, and responses from teammates. " +
    "Check your inbox at the start of a task to see if other agents left you context.",
  inputSchema: {
    type: "object",
    properties: {
      pipelineRunId: {
        type: "string",
        description: "Pipeline run DB ID. If omitted, returns messages from the most recent run.",
      },
    },
    required: [],
  },
};

export const TOOL_GET_PROJECT_INFO: ToolDefinition = {
  name: "get_project_info",
  description:
    "Get project metadata including name, path, current tech stack, and summary counts. " +
    "Use this to understand the project context or check the current stack before making changes.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const TOOL_UPDATE_PROJECT_STACK: ToolDefinition = {
  name: "update_project_stack",
  description:
    "Update the project's tech stack identifier. This affects which skills and best practices " +
    "get loaded for subsequent pipeline steps. Use a short lowercase string matching the primary " +
    'framework (e.g. "nextjs", "django", "react", "go", "spring-boot", "rails", "fastapi").',
  inputSchema: {
    type: "object",
    properties: {
      stack: {
        type: "string",
        description:
          'The new stack identifier (e.g. "nextjs", "django", "fastapi")',
      },
    },
    required: ["stack"],
  },
};

