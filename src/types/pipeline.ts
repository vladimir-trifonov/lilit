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
  outputSummary: string | null;
  costUsd: number;
  startedAt: string | null;
  completedAt: string | null;
}
