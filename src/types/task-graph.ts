/**
 * Task graph types for the PM-driven dynamic orchestration system.
 *
 * The task graph replaces the sequential pipeline with a dependency-aware
 * DAG where the PM makes routing decisions at every event.
 */

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "blocked"
  | "cancelled";

export interface TaskNode {
  id: string; // "t1", "t2", etc.
  title: string;
  description: string;
  agent: string;
  role?: string;
  dependsOn: string[]; // task IDs that must complete first
  acceptanceCriteria: string[];
  skills?: string[];
  provider?: string;
  model?: string;
  status: TaskStatus;
  output?: string;
  error?: string;
  costUsd?: number;
  attempts: number;
  addedBy: "initial" | string; // "initial" or PM decision ID
  userQuestion?: string; // if blocked on user input
  agentQuestion?: string; // captured from agent output
}

export interface TaskGraph {
  tasks: Record<string, TaskNode>;
}

// ── PM decision output types ───────────────────────────────────────────────

export type PMDecisionAction =
  | { type: "execute"; taskIds: string[] }
  | {
      type: "add_tasks";
      tasks: Omit<TaskNode, "status" | "attempts" | "addedBy">[];
    }
  | { type: "remove_tasks"; taskIds: string[]; reason: string }
  | {
      type: "reassign";
      taskId: string;
      agent: string;
      role?: string;
      reason: string;
    }
  | {
      type: "retry";
      taskId: string;
      changes?: { description?: string; agent?: string; role?: string };
    }
  | {
      type: "ask_user";
      question: string;
      context: string;
      blockingTaskIds?: string[];
    }
  | { type: "answer_agent"; taskId: string; answer: string }
  | { type: "complete"; summary: string }
  | { type: "skip"; taskIds: string[]; reason: string };

export interface PMDecision {
  reasoning: string;
  actions: PMDecisionAction[];
}

// ── Decision triggers ──────────────────────────────────────────────────────

export type DecisionTrigger =
  | { type: "initial"; readyTasks: string[] }
  | { type: "task_completed"; taskId: string; output: string }
  | { type: "task_failed"; taskId: string; error: string; attempts: number }
  | { type: "user_message"; message: string }
  | {
      type: "agent_question";
      taskId: string;
      agent: string;
      question: string;
    }
  | {
      type: "agent_message_to_pm";
      taskId: string;
      agent: string;
      messageType: string;
      content: string;
    }
  | { type: "all_idle" }
  | { type: "budget_warning"; spent: number; remaining: number };

// ── PM decision context ────────────────────────────────────────────────────

export interface PMDecisionContext {
  trigger: DecisionTrigger;
  graph: TaskGraph;
  runningTasks: string[];
  completedTasks: { id: string; outputSummary: string; costUsd: number }[];
  failedTasks: { id: string; error: string; attempts: number }[];
  readyTasks: string[];
  budget: { spent: number; limit: number; remaining: number };
  availableAgents: {
    type: string;
    name: string;
    roles: string[];
    capabilities: string[];
  }[];
  /** Agent messages sent TO PM during this run */
  agentMessagesToPM: {
    from: string;
    type: string;
    content: string;
    taskId: string;
  }[];
  /** Agent messages between other agents (for PM awareness) */
  recentAgentMessages: {
    from: string;
    to: string;
    type: string;
    content: string;
  }[];
  userMessages: string[];
  elapsedMs: number;
}
