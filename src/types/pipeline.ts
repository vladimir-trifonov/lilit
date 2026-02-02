/**
 * Shared pipeline types used across the application
 */

export type AgentType = "architect" | "pm" | "developer" | "qa";
export type AgentRole = "code" | "review" | "fix" | "devops" | "automation" | "manual";
export type StepStatus = "pending" | "running" | "done" | "failed";

export interface PipelineStep {
  agent: AgentType;
  role?: AgentRole;
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
