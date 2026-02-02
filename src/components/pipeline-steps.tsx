/**
 * Pipeline step indicators component
 * Shows visual progress of agent steps with icons and status
 */

import { Badge } from "@/components/ui/badge";
import type { PipelineStep, StepStatus } from "@/types/pipeline";

interface PipelineStepsProps {
  steps: PipelineStep[];
  className?: string;
}

function getStatusIcon(status: StepStatus): string {
  switch (status) {
    case "running":
      return "🔄";
    case "done":
      return "✅";
    case "failed":
      return "❌";
    case "pending":
      return "⚪";
    default:
      return "⚪";
  }
}

function getStatusColor(status: StepStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "done":
      return "secondary";
    case "failed":
      return "destructive";
    case "pending":
      return "outline";
    default:
      return "outline";
  }
}

export function PipelineSteps({ steps, className = "" }: PipelineStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="text-xs font-medium text-zinc-500">Pipeline Progress</div>
      <div className="flex flex-wrap gap-2 items-center">
        {steps.map((step, idx) => {
          const label = step.role ? `${step.agent}:${step.role}` : step.agent;
          const icon = getStatusIcon(step.status);
          const isAnimated = step.status === "running";

          return (
            <div key={idx} className="flex items-center gap-1">
              <span className={isAnimated ? "animate-spin" : ""}>{icon}</span>
              <Badge variant={getStatusColor(step.status)} className="text-[10px] px-2 py-0.5">
                {label}
              </Badge>
              {idx < steps.length - 1 && <span className="text-zinc-600 text-xs mx-1">→</span>}
            </div>
          );
        })}
      </div>
      {steps.some((s) => s.stepNumber) && (
        <div className="text-[10px] text-zinc-600">
          Step {steps.find((s) => s.status === "running")?.stepNumber ?? steps.filter((s) => s.status === "done").length}{" "}
          of {steps[0]?.totalSteps ?? steps.length}
        </div>
      )}
    </div>
  );
}
