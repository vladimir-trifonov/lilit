/**
 * Parse live log content to extract pipeline steps and their status.
 *
 * Steps are seeded from the "🔄 Pipeline:" line and then dynamically extended
 * when fix cycles inject new steps via "📍 STEP X/Y:" markers.
 */

import type { PipelineStep } from "@/types/pipeline";

/**
 * Parse log content to extract pipeline steps
 */
export function parseLogSteps(logContent: string): PipelineStep[] {
  const steps: PipelineStep[] = [];
  const lines = logContent.split("\n");

  for (const line of lines) {
    // Parse pipeline plan: "🔄 Pipeline: pm → developer:code → developer:review"
    const pipelineMatch = line.match(/🔄 Pipeline: (.+)/);
    if (pipelineMatch) {
      const planSteps = pipelineMatch[1]
        .split("→")
        .map((s) => s.trim())
        .filter(Boolean);

      // Initialize all steps as pending (only on the first pipeline line)
      if (steps.length === 0) {
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
      }
      continue;
    }

    // Parse step start: "📍 STEP 1/5: developer:code"
    const stepStartMatch = line.match(/📍 STEP (\d+)\/(\d+): (\w+)(?::(\w+))?/);
    if (stepStartMatch) {
      const stepNum = parseInt(stepStartMatch[1]);
      const totalSteps = parseInt(stepStartMatch[2]);
      const agent = stepStartMatch[3] as string;
      const role = stepStartMatch[4] as string | undefined;
      const title = role ? `${agent}:${role}` : agent;

      // Update totalSteps on all existing steps when fix cycles expand the pipeline
      if (totalSteps > (steps[0]?.totalSteps ?? 0)) {
        for (const s of steps) s.totalSteps = totalSteps;
      }

      // Find by step number first, then by agent:role match
      const existingIdx = steps.findIndex(
        (s) => s.stepNumber === stepNum || (s.agent === agent && s.role === role && s.status === "pending")
      );

      if (existingIdx >= 0) {
        // Update existing step (may have changed agent:role due to fix injection)
        steps[existingIdx].agent = agent;
        steps[existingIdx].role = role;
        steps[existingIdx].title = title;
        steps[existingIdx].status = "running";
        steps[existingIdx].stepNumber = stepNum;
        steps[existingIdx].totalSteps = totalSteps;
      } else {
        // Injected step not in the original plan — add it
        steps.push({
          agent,
          role,
          title,
          status: "running",
          stepNumber: stepNum,
          totalSteps,
        });
      }

      continue;
    }

    // Parse step completion: "[agent:role] Done (Xs)" or "✅ [agent:role] Done (Xs)"
    const doneMatch = line.match(/(?:✅ )?\[([^\]]+)\] Done/);
    if (doneMatch) {
      const label = doneMatch[1];
      const idx = findStepIndex(steps, label);
      if (idx >= 0) {
        steps[idx].status = "done";
      }
      continue;
    }

    // Parse step failure: "[agent:role] Failed" (with or without prefix)
    const failMatch = line.match(/(?:❌ )?\[([^\]]+)\] Failed/);
    if (failMatch) {
      const label = failMatch[1];
      const idx = findStepIndex(steps, label);
      if (idx >= 0) {
        steps[idx].status = "failed";
      }
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
 * Find a step by label, checking title, agent:role, and agent name.
 * For ambiguous matches (e.g. two "developer:code" steps), prefer
 * the one currently running, then the first pending one.
 */
function findStepIndex(steps: PipelineStep[], label: string): number {
  // Exact title / agent:role / agent match — prefer running step
  const running = steps.findIndex(
    (s) =>
      s.status === "running" &&
      (s.title === label || `${s.agent}:${s.role}` === label || s.agent === label)
  );
  if (running >= 0) return running;

  // Fallback: any matching step
  return steps.findIndex(
    (s) => s.title === label || `${s.agent}:${s.role}` === label || s.agent === label
  );
}
