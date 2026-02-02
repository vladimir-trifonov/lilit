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
}
