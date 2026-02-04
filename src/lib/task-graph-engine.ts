/**
 * Task graph engine — pure functions for graph operations.
 *
 * No PM logic, no I/O, no side effects. Operates on immutable TaskGraph
 * structures and returns new copies on mutation.
 */

import type { TaskGraph, TaskNode, TaskStatus } from "@/types/task-graph";
import { TASK_OUTPUT_SUMMARY_LENGTH } from "@/lib/constants";

const TERMINAL_STATUSES = new Set<TaskStatus>(["done", "skipped", "cancelled"]);
const INACTIVE_STATUSES = new Set<TaskStatus>([
  "done",
  "skipped",
  "cancelled",
  "failed",
]);

/**
 * Return task IDs where all `dependsOn` are done/skipped and the task is pending or ready.
 */
export function getReadyTasks(graph: TaskGraph): string[] {
  return Object.values(graph.tasks)
    .filter((task) => {
      if (task.status === "ready") return true;
      if (task.status !== "pending") return false;
      return task.dependsOn.every((depId) => {
        const dep = graph.tasks[depId];
        return dep && TERMINAL_STATUSES.has(dep.status);
      });
    })
    .map((t) => t.id);
}

/**
 * Immutable update of a task's status and optional fields.
 * After updating, auto-promotes downstream tasks from "pending" to "ready"
 * if all their dependencies are now terminal.
 */
export function updateTaskStatus(
  graph: TaskGraph,
  taskId: string,
  update: Partial<Pick<TaskNode, "status" | "output" | "error" | "costUsd" | "attempts">>,
): TaskGraph {
  const task = graph.tasks[taskId];
  if (!task) return graph;

  const updatedTasks = { ...graph.tasks };
  updatedTasks[taskId] = { ...task, ...update };

  // Auto-promote downstream tasks if this task became terminal
  if (update.status && TERMINAL_STATUSES.has(update.status)) {
    for (const candidate of Object.values(updatedTasks)) {
      if (candidate.status !== "pending") continue;
      if (!candidate.dependsOn.includes(taskId)) continue;

      const allDepsDone = candidate.dependsOn.every((depId) => {
        const dep = updatedTasks[depId];
        return dep && TERMINAL_STATUSES.has(dep.status);
      });
      if (allDepsDone) {
        updatedTasks[candidate.id] = { ...candidate, status: "ready" };
      }
    }
  }

  return { tasks: updatedTasks };
}

/**
 * Insert new task nodes into the graph.
 */
export function addTasksToGraph(
  graph: TaskGraph,
  newTasks: Omit<TaskNode, "status" | "attempts" | "addedBy">[],
  addedBy: string,
): TaskGraph {
  const updatedTasks = { ...graph.tasks };

  for (const task of newTasks) {
    const allDepsDone = task.dependsOn.every((depId) => {
      const dep = updatedTasks[depId];
      return dep && TERMINAL_STATUSES.has(dep.status);
    });

    updatedTasks[task.id] = {
      ...task,
      status: allDepsDone ? "ready" : "pending",
      attempts: 0,
      addedBy,
    };
  }

  return { tasks: updatedTasks };
}

/**
 * Mark tasks as cancelled in the graph.
 */
export function removeTasksFromGraph(
  graph: TaskGraph,
  taskIds: string[],
): TaskGraph {
  const updatedTasks = { ...graph.tasks };
  const cancelledSet = new Set(taskIds);

  for (const id of taskIds) {
    if (updatedTasks[id]) {
      updatedTasks[id] = { ...updatedTasks[id], status: "cancelled" };
    }
  }

  // Auto-promote tasks that depended only on cancelled tasks
  for (const candidate of Object.values(updatedTasks)) {
    if (candidate.status !== "pending") continue;
    const allDepsDone = candidate.dependsOn.every((depId) => {
      if (cancelledSet.has(depId)) return true;
      const dep = updatedTasks[depId];
      return dep && TERMINAL_STATUSES.has(dep.status);
    });
    if (allDepsDone) {
      updatedTasks[candidate.id] = { ...candidate, status: "ready" };
    }
  }

  return { tasks: updatedTasks };
}

/**
 * Check if the graph is complete: all tasks are done, skipped, or cancelled.
 */
export function isGraphComplete(graph: TaskGraph): boolean {
  return Object.values(graph.tasks).every((t) => INACTIVE_STATUSES.has(t.status));
}

/**
 * Check if the graph is stuck: no running tasks, no ready tasks,
 * but pending/blocked tasks still exist.
 */
export function isGraphStuck(graph: TaskGraph): boolean {
  const tasks = Object.values(graph.tasks);
  const hasRunning = tasks.some((t) => t.status === "running");
  if (hasRunning) return false;

  const hasReady = tasks.some((t) => t.status === "ready");
  if (hasReady) return false;

  const hasPendingOrBlocked = tasks.some(
    (t) => t.status === "pending" || t.status === "blocked",
  );
  return hasPendingOrBlocked;
}

/**
 * Produce a compact string summary of the graph for PM prompt injection.
 */
export function getGraphSummary(graph: TaskGraph): string {
  const lines: string[] = [];
  const tasks = Object.values(graph.tasks).sort((a, b) => a.id.localeCompare(b.id));

  for (const task of tasks) {
    const deps =
      task.dependsOn.length > 0 ? ` (depends: ${task.dependsOn.join(", ")})` : "";
    const outputHint =
      task.status === "done" && task.output
        ? ` — output: ${task.output.slice(0, TASK_OUTPUT_SUMMARY_LENGTH)}`
        : "";
    const errorHint =
      task.status === "failed" && task.error
        ? ` — error: ${task.error.slice(0, TASK_OUTPUT_SUMMARY_LENGTH)}`
        : "";

    lines.push(
      `- ${task.id} [${task.status}] ${task.agent}${task.role ? `:${task.role}` : ""}: ${task.title}${deps}${outputHint}${errorHint}`,
    );
  }

  return lines.join("\n");
}

/**
 * Reassign a task to a different agent/role.
 */
export function reassignTask(
  graph: TaskGraph,
  taskId: string,
  agent: string,
  role?: string,
): TaskGraph {
  const task = graph.tasks[taskId];
  if (!task) return graph;

  return {
    tasks: {
      ...graph.tasks,
      [taskId]: { ...task, agent, role },
    },
  };
}

/**
 * Mark task as blocked (e.g. waiting for user input).
 */
export function blockTask(
  graph: TaskGraph,
  taskId: string,
  question: string,
): TaskGraph {
  const task = graph.tasks[taskId];
  if (!task) return graph;

  return {
    tasks: {
      ...graph.tasks,
      [taskId]: { ...task, status: "blocked", userQuestion: question },
    },
  };
}

/**
 * Unblock a task and set it back to ready.
 */
export function unblockTask(graph: TaskGraph, taskId: string): TaskGraph {
  const task = graph.tasks[taskId];
  if (!task || task.status !== "blocked") return graph;

  return {
    tasks: {
      ...graph.tasks,
      [taskId]: { ...task, status: "ready", userQuestion: undefined },
    },
  };
}

/**
 * Reset a failed task back to pending for retry, incrementing attempts.
 */
export function retryTask(
  graph: TaskGraph,
  taskId: string,
  changes?: { description?: string; agent?: string; role?: string },
): TaskGraph {
  const task = graph.tasks[taskId];
  if (!task) return graph;

  return {
    tasks: {
      ...graph.tasks,
      [taskId]: {
        ...task,
        status: "ready",
        error: undefined,
        output: undefined,
        attempts: task.attempts + 1,
        ...(changes?.description ? { description: changes.description } : {}),
        ...(changes?.agent ? { agent: changes.agent } : {}),
        ...(changes?.role ? { role: changes.role } : {}),
      },
    },
  };
}

/**
 * Generate the next available task ID for the graph.
 */
export function nextTaskId(graph: TaskGraph): string {
  const existing = Object.keys(graph.tasks);
  let max = 0;
  for (const id of existing) {
    const num = parseInt(id.replace("t", ""), 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return `t${max + 1}`;
}
