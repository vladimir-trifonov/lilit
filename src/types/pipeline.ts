/**
 * Shared pipeline types used across the application
 */

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface PipelineStep {
  agent: string;
  role?: string;
  title: string;
  status: StepStatus;
  stepNumber?: number;
  totalSteps?: number;
}

export interface StepInfo {
  agent: string;
  role?: string;
  title: string;
  status: string;
  output?: string;
}

/** Progress event emitted during pipeline execution (logging, UI updates). */
export type PipelineProgressEvent = {
  type: "agent_start" | "agent_done" | "agent_error" | "agent_message" | "pipeline_adapted" | "plan_ready" | "plan_awaiting_confirmation" | "plan_confirmed" | "plan_rejected" | "summary" | "done" | "output";
  agent?: string;
  role?: string;
  title?: string;
  message?: string;
  step?: number;
  totalSteps?: number;
  chunk?: string;
};

/** Shape returned by GET /api/pipeline `tasks` array */
export interface DbTask {
  id: string;
  title: string;
  description: string;
  assignedAgent: string | null;
  assignedRole: string | null;
  status: string; // created | assigned | in_progress | done | failed | blocked | cancelled | skipped
  sequenceOrder: number;
  graphId: string | null; // "t1", "t2" etc.
  dependsOn: string[]; // graph IDs this depends on
  acceptanceCriteria: string[];
  outputSummary: string | null;
  costUsd: number;
  startedAt: string | null;
  completedAt: string | null;
}

/** Shape returned by GET /api/pipeline `pastRuns` array (summary only — no tasks) */
export interface PastRun {
  runId: string;
  status: string;
  userMessage: string;
  runningCost: number;
  createdAt: string;
  updatedAt: string;
  /** PM plan analysis summary for the collapsed label */
  planAnalysis?: string | null;
  /** Number of tasks in this pipeline run */
  taskCount?: number;
  /** Persisted log content, lazy-loaded via /api/pipeline/[runId] */
  logContent?: string | null;
  /** Tasks for this run, lazy-loaded via /api/pipeline/[runId] */
  tasks?: DbTask[];
  /** UI state: whether this run is expanded in the activity log */
  expanded?: boolean;
  /** UI state: whether logContent is currently being fetched */
  loading?: boolean;
}
