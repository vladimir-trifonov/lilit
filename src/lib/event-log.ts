/**
 * Event Log — Layer 2 of the Hybrid Context system.
 * Append-only log of everything that happens during task execution.
 * Agents receive relevant event history as context.
 */

import { prisma } from "./prisma";

export type EventType =
  | "plan_created"        // PM created execution plan
  | "architecture_defined" // Architect defined tech stack
  | "task_started"        // Agent started working on task
  | "code_written"        // Dev:code produced code
  | "review_done"         // Dev:review completed review
  | "fix_applied"         // Dev:fix applied a fix
  | "devops_configured"   // Dev:devops set up infra
  | "tests_written"       // QA:automation wrote/ran tests
  | "browser_tested"      // QA:manual tested in browser
  | "bug_found"           // QA found a bug
  | "feedback_routed"     // PM re-evaluated after failure

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
