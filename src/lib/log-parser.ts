/**
 * Parse live log content to extract pipeline steps and their status
 */

import type { PipelineStep } from "@/types/pipeline";

/**
 * Parse log content to extract pipeline steps
 */
export function parseLogSteps(logContent: string): PipelineStep[] {
  const steps: PipelineStep[] = [];
  const lines = logContent.split("\n");

  let currentStep: Partial<PipelineStep> | null = null;
  let planSteps: string[] = [];

  for (const line of lines) {
    // Parse pipeline plan: "🔄 Pipeline: pm → developer:code → developer:review"
    const pipelineMatch = line.match(/🔄 Pipeline: (.+)/);
    if (pipelineMatch) {
      planSteps = pipelineMatch[1]
        .split("→")
        .map((s) => s.trim())
        .filter(Boolean);

      // Initialize all steps as pending
      planSteps.forEach((stepLabel, idx) => {
        const [agent, role] = stepLabel.split(":") as [string, string | undefined];
        steps.push({
          agent,
          role,
          title: stepLabel,
          status: "pending",
          stepNumber: idx + 1,
          totalSteps: planSteps.length,
        });
      });
      continue;
    }

    // Parse step start: "📍 STEP 1/5: developer:code"
    const stepStartMatch = line.match(/📍 STEP (\d+)\/(\d+): (\w+)(?::(\w+))?/);
    if (stepStartMatch) {
      const stepNum = parseInt(stepStartMatch[1]);
      const totalSteps = parseInt(stepStartMatch[2]);
      const agent = stepStartMatch[3] as string;
      const role = stepStartMatch[4] as string | undefined;

      currentStep = {
        agent,
        role,
        title: role ? `${agent}:${role}` : agent,
        status: "running",
        stepNumber: stepNum,
        totalSteps,
      };

      // Update step in list if it exists
      const existingIdx = steps.findIndex(
        (s) => s.stepNumber === stepNum || (s.agent === agent && s.role === role)
      );
      if (existingIdx >= 0) {
        steps[existingIdx].status = "running";
      } else {
        steps.push(currentStep as PipelineStep);
      }
      continue;
    }

    // Parse step completion: "✅ [agent:role] Done"
    const doneMatch = line.match(/✅ \[([^\]]+)\] Done/);
    if (doneMatch && currentStep) {
      const label = doneMatch[1];
      const idx = steps.findIndex((s) => s.title === label || `${s.agent}:${s.role}` === label || s.agent === label);
      if (idx >= 0) {
        steps[idx].status = "done";
      }
      currentStep = null;
      continue;
    }

    // Parse step failure: "❌ [agent:role] Failed"
    const failMatch = line.match(/❌ \[([^\]]+)\] Failed/);
    if (failMatch && currentStep) {
      const label = failMatch[1];
      const idx = steps.findIndex((s) => s.title === label || `${s.agent}:${s.role}` === label || s.agent === label);
      if (idx >= 0) {
        steps[idx].status = "failed";
      }
      currentStep = null;
      continue;
    }

    // Parse abort
    if (line.includes("🛑 PIPELINE ABORTED")) {
      // Mark all running/pending steps as failed
      steps.forEach((s) => {
        if (s.status === "running" || s.status === "pending") {
          s.status = "failed";
        }
      });
      break;
    }
  }

  return steps;
}

/**
 * Get a summary status from all steps
 */
export function getPipelineStatus(steps: PipelineStep[]): "idle" | "running" | "done" | "failed" {
  if (steps.length === 0) return "idle";

  const hasRunning = steps.some((s) => s.status === "running");
  if (hasRunning) return "running";

  const hasFailed = steps.some((s) => s.status === "failed");
  if (hasFailed) return "failed";

  const allDone = steps.every((s) => s.status === "done");
  if (allDone) return "done";

  return "idle";
}
