/**
 * Event Log — Layer 2 of the Hybrid Context system.
 * Append-only log of everything that happens during task execution.
 * Agents receive relevant event history as context.
 */

import { prisma } from "./prisma";

export type EventType = string;

// Well-known event types (not exhaustive — new agents can add their own)
export const EVENT_TYPES = {
  plan_created: "plan_created",
  plan_awaiting_confirmation: "plan_awaiting_confirmation",
  plan_confirmed: "plan_confirmed",
  plan_rejected: "plan_rejected",
  architecture_defined: "architecture_defined",
  task_started: "task_started",
  task_completed: "task_completed",
  code_written: "code_written",
  review_done: "review_done",
  fix_applied: "fix_applied",
  devops_configured: "devops_configured",
  tests_written: "tests_written",
  browser_tested: "browser_tested",
  bug_found: "bug_found",
  feedback_routed: "feedback_routed",
} as const;

export interface EventData {
  [key: string]: unknown;
}

/**
 * Append an event to the log.
 */
export async function logEvent(opts: {
  projectId: string;
  taskId?: string;
  agent: string;
  role?: string;
  type: EventType;
  data: EventData;
}) {
  return prisma.eventLog.create({
    data: {
      projectId: opts.projectId,
      taskId: opts.taskId,
      agent: opts.agent,
      role: opts.role,
      type: opts.type,
      data: JSON.stringify(opts.data),
    },
  });
}

/**
 * Get event history for a project (or filtered by task).
 */
export async function getEventHistory(opts: {
  projectId: string;
  taskId?: string;
  limit?: number;
}): Promise<Array<{
  agent: string;
  role: string | null;
  type: string;
  data: EventData;
  createdAt: Date;
}>> {
  const events = await prisma.eventLog.findMany({
    where: {
      projectId: opts.projectId,
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 100,
    select: {
      agent: true,
      role: true,
      type: true,
      data: true,
      createdAt: true,
    },
  });

  return events.map((e: { agent: string; role: string | null; type: string; data: string; createdAt: Date }) => ({
    ...e,
    data: JSON.parse(e.data) as EventData,
  }));
}

/**
 * Format event history as context string for an agent prompt.
 */
export function formatEventsForPrompt(
  events: Awaited<ReturnType<typeof getEventHistory>>
): string {
  if (events.length === 0) return "No previous events.";

  return events
    .map((e) => {
      const who = e.role ? `${e.agent}:${e.role}` : e.agent;
      const summary =
        typeof e.data.summary === "string"
          ? e.data.summary
          : JSON.stringify(e.data, null, 2);
      return `[${who}] ${e.type}: ${summary}`;
    })
    .join("\n\n");
}
