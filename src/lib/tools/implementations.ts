/**
 * Tool implementations — pure async functions that execute DB queries.
 * Each function takes typed params + a projectId context and returns a result.
 * These are provider-agnostic and know nothing about MCP or function-calling.
 */

import { prisma } from "@/lib/prisma";

// ── search_project_history ──────────────────────────────────────────────────

interface SearchHistoryParams {
  query: string;
  limit?: number;
  source?: "all" | "messages" | "events" | "memories";
}

export async function searchProjectHistory(
  projectId: string,
  params: SearchHistoryParams,
): Promise<unknown> {
  const { query, limit = 10, source = "all" } = params;
  const results: unknown[] = [];

  // Search conversation messages
  if (source === "all" || source === "messages") {
    const messages = await prisma.message.findMany({
      where: {
        conversation: { projectId },
        content: { contains: query, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });
    for (const m of messages) {
      results.push({
        source: "message",
        id: m.id,
        role: m.role,
        content: m.content.slice(0, 500),
        createdAt: m.createdAt,
      });
    }
  }

  // Search event logs
  if (source === "all" || source === "events") {
    const events = await prisma.eventLog.findMany({
      where: {
        projectId,
        data: { contains: query, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        agent: true,
        role: true,
        type: true,
        data: true,
        createdAt: true,
      },
    });
    for (const e of events) {
      results.push({
        source: "event",
        id: e.id,
        agent: e.agent,
        role: e.role,
        type: e.type,
        data: e.data.slice(0, 500),
        createdAt: e.createdAt,
      });
    }
  }

  // Search memories (text search — RAG vector search is a separate path)
  if (source === "all" || source === "memories") {
    const memories = await prisma.memory.findMany({
      where: {
        projectId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        agent: true,
        significance: true,
        createdAt: true,
      },
    });
    for (const m of memories) {
      results.push({
        source: "memory",
        id: m.id,
        type: m.type,
        title: m.title,
        content: m.content.slice(0, 500),
        agent: m.agent,
        significance: m.significance,
        createdAt: m.createdAt,
      });
    }
  }

  // Sort by recency across all sources
  results.sort((a, b) => {
    const aDate = (a as { createdAt: Date }).createdAt;
    const bDate = (b as { createdAt: Date }).createdAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  return { results: results.slice(0, limit), total: results.length };
}

// ── list_tasks ──────────────────────────────────────────────────────────────

interface ListTasksParams {
  status?: string;
  pipelineRunId?: string;
  limit?: number;
}

export async function listTasks(
  projectId: string,
  params: ListTasksParams,
): Promise<unknown> {
  const { status, pipelineRunId, limit = 20 } = params;

  const where: Record<string, unknown> = { projectId };
  if (status) where.status = status;

  // Resolve external runId to internal DB id
  if (pipelineRunId) {
    const run = await prisma.pipelineRun.findUnique({
      where: { runId: pipelineRunId },
      select: { id: true },
    });
    if (run) where.pipelineRunId = run.id;
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      assignedAgent: true,
      assignedRole: true,
      sequenceOrder: true,
      costUsd: true,
      createdAt: true,
      completedAt: true,
    },
  });

  return { tasks, total: tasks.length };
}

// ── get_task ────────────────────────────────────────────────────────────────

interface GetTaskParams {
  taskId: string;
}

export async function getTask(
  _projectId: string,
  params: GetTaskParams,
): Promise<unknown> {
  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    include: {
      notes: { orderBy: { createdAt: "asc" } },
      children: {
        select: {
          id: true,
          title: true,
          status: true,
          assignedAgent: true,
        },
      },
    },
  });

  if (!task) return { error: "Task not found" };

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    skills: task.skills,
    status: task.status,
    assignedAgent: task.assignedAgent,
    assignedRole: task.assignedRole,
    output: task.output ? task.output.slice(0, 2000) : null,
    outputSummary: task.outputSummary,
    costUsd: task.costUsd,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    notes: task.notes.map((n) => ({
      author: n.author,
      content: n.content,
      createdAt: n.createdAt,
    })),
    subTasks: task.children,
  };
}

// ── update_task_status ──────────────────────────────────────────────────────

interface UpdateTaskStatusParams {
  taskId: string;
  status: string;
  note?: string;
}

export async function updateTaskStatus(
  _projectId: string,
  params: UpdateTaskStatusParams,
): Promise<unknown> {
  const { taskId, status, note } = params;

  const data: Record<string, unknown> = { status };
  if (status === "in_progress") data.startedAt = new Date();
  if (status === "done" || status === "failed") data.completedAt = new Date();

  const task = await prisma.task.update({
    where: { id: taskId },
    data,
    select: { id: true, title: true, status: true },
  });

  if (note) {
    await prisma.taskNote.create({
      data: {
        taskId,
        author: "agent",
        content: note,
      },
    });
  }

  return { success: true, task };
}

// ── get_messages ────────────────────────────────────────────────────────────

interface GetMessagesParams {
  count?: number;
  conversationId?: string;
}

export async function getMessages(
  projectId: string,
  params: GetMessagesParams,
): Promise<unknown> {
  const { count = 10 } = params;
  let conversationId = params.conversationId;

  // Find most recent conversation if not specified
  if (!conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!conv) return { messages: [], total: 0 };
    conversationId = conv.id;
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: count,
    select: {
      id: true,
      role: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  // Reverse to chronological order
  messages.reverse();

  return {
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt,
    })),
    total: messages.length,
  };
}

// ── get_step_output ─────────────────────────────────────────────────────────

interface GetStepOutputParams {
  taskId: string;
}

export async function getStepOutput(
  _projectId: string,
  params: GetStepOutputParams,
): Promise<unknown> {
  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      title: true,
      status: true,
      output: true,
      outputSummary: true,
      assignedAgent: true,
      assignedRole: true,
    },
  });

  if (!task) return { error: "Task not found" };

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    assignedAgent: task.assignedAgent,
    assignedRole: task.assignedRole,
    output: task.output,
    outputSummary: task.outputSummary,
  };
}

// ── get_project_info ────────────────────────────────────────────────────────

export async function getProjectInfo(
  projectId: string,
  params: Record<string, never>,
): Promise<unknown> {
  void params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      path: true,
      stack: true,
      description: true,
      createdAt: true,
      _count: {
        select: { conversations: true, pipelineRuns: true },
      },
    },
  });

  if (!project) return { error: "Project not found" };

  return {
    name: project.name,
    path: project.path,
    stack: project.stack,
    description: project.description,
    conversationCount: project._count.conversations,
    pipelineRunCount: project._count.pipelineRuns,
    createdAt: project.createdAt,
  };
}

// ── update_project_stack ────────────────────────────────────────────────────

interface UpdateProjectStackParams {
  stack: string;
}

export async function updateProjectStack(
  projectId: string,
  params: UpdateProjectStackParams,
): Promise<unknown> {
  const cleaned = params.stack
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 30);

  if (!cleaned) return { error: "Stack identifier cannot be empty" };

  // Read current settings and merge stack into the JSON blob (dual-storage sync)
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { settings: true },
  });

  let settings: Record<string, unknown> = {};
  if (project?.settings) {
    try {
      settings = JSON.parse(project.settings) as Record<string, unknown>;
    } catch {
      // Corrupted settings — start fresh
    }
  }
  settings.stack = cleaned;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      stack: cleaned,
      settings: JSON.stringify(settings),
      updatedAt: new Date(),
    },
  });

  return { success: true, stack: cleaned };
}

// ── get_pipeline_runs ───────────────────────────────────────────────────────

interface GetPipelineRunsParams {
  limit?: number;
  status?: string;
}

export async function getPipelineRuns(
  projectId: string,
  params: GetPipelineRunsParams,
): Promise<unknown> {
  const { limit = 10, status } = params;

  const where: Record<string, unknown> = { projectId };
  if (status) where.status = status;

  const runs = await prisma.pipelineRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      runId: true,
      status: true,
      userMessage: true,
      currentStep: true,
      runningCost: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { tasks: true } },
    },
  });

  return {
    runs: runs.map((r) => ({
      id: r.id,
      runId: r.runId,
      status: r.status,
      userMessage: r.userMessage.slice(0, 200),
      currentStep: r.currentStep,
      taskCount: r._count.tasks,
      runningCost: r.runningCost,
      error: r.error ? r.error.slice(0, 200) : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    total: runs.length,
  };
}
