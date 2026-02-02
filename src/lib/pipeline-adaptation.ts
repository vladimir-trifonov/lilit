/**
 * Pipeline Adaptation — PM-driven mid-execution pipeline modification.
 *
 * After each pipeline step, if agents have sent actionable messages (flags,
 * questions, suggestions), the PM evaluates whether the remaining pipeline
 * needs adjustment. The PM can add steps, remove upcoming steps, or reorder
 * the remaining pipeline.
 *
 * This module provides:
 *  - Prompt builder for PM adaptation evaluation
 *  - Response parser for extracting adaptation decisions
 *  - Types for adaptation actions
 */

// ---- Types ----

export interface PipelineAdaptation {
  action: "continue" | "modify";
  reason?: string;
  addSteps?: string[];       // e.g. ["developer:fix", "qa:automation"]
  removeIndices?: number[];  // indices into remaining pipeline (0-based from current position)
  newPipeline?: string[];    // full replacement of remaining steps (alternative to add/remove)
}

export interface AdaptationRecord {
  afterStep: number;
  adaptation: PipelineAdaptation;
  triggeredBy: string[];     // message IDs that triggered the evaluation
  costUsd: number;
}

// ---- Prompt builder ----

/**
 * Build a prompt for PM to evaluate whether the pipeline needs adaptation
 * based on agent messages received during execution.
 */
export function buildAdaptationPrompt(opts: {
  currentStepIndex: number;
  completedStepLabel: string;
  completedSteps: Array<{ agent: string; role?: string; title: string; status: string }>;
  remainingPipeline: string[];
  agentMessages: Array<{ fromAgent: string; toAgent: string; type: string; content: string }>;
  userMessage: string;
}): string {
  const completed = opts.completedSteps
    .map((s, i) => `  ${i + 1}. [${s.status}] ${s.role ? `${s.agent}:${s.role}` : s.agent} — ${s.title}`)
    .join("\n");

  const remaining = opts.remainingPipeline
    .map((s, i) => `  ${i + 1}. ${s}`)
    .join("\n");

  const messages = opts.agentMessages
    .map((m) => `  - [${m.type}] ${m.fromAgent} → ${m.toAgent}: ${m.content}`)
    .join("\n");

  return `## Pipeline Adaptation Check

You are the PM. Step ${opts.currentStepIndex + 1} ("${opts.completedStepLabel}") just finished.
Agents have sent messages during execution that may warrant pipeline changes.

### Original Request
${opts.userMessage.slice(0, 500)}

### Completed Steps
${completed}

### Remaining Pipeline
${remaining || "  (no remaining steps)"}

### Agent Messages (This Run)
${messages}

### Your Decision

Evaluate the agent messages above. Decide whether the REMAINING pipeline should be modified.

**Rules:**
- Only suggest changes if messages indicate a genuine need (not cosmetic)
- Prefer minimal changes — add/remove individual steps rather than rewriting the whole pipeline
- A "flag" or "question" message is more likely to warrant adaptation than a "suggestion" or "handoff"
- Do NOT re-run already completed steps
- Available agents/roles: pm, architect, developer:code, developer:review, developer:fix, developer:devops, qa:automation, qa:manual

Respond with EXACTLY one of these formats:

**If no changes needed:**
\`\`\`
[ADAPTATION]
{"action": "continue"}
[/ADAPTATION]
\`\`\`

**If changes needed:**
\`\`\`
[ADAPTATION]
{"action": "modify", "reason": "<brief explanation>", "addSteps": ["agent:role", ...], "removeIndices": [0, 2]}
[/ADAPTATION]
\`\`\`

- \`addSteps\`: steps to insert NEXT in the pipeline (before remaining steps)
- \`removeIndices\`: 0-based indices into the REMAINING pipeline to remove

Respond with the adaptation block only. No other text.`;
}

// ---- Response parser ----

const ADAPTATION_RE = /\[ADAPTATION\]\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*\[\/ADAPTATION\]/;

/**
 * Parse PM's adaptation response into a structured decision.
 * Returns "continue" adaptation if parsing fails.
 */
export function parseAdaptation(output: string): PipelineAdaptation {
  const match = output.match(ADAPTATION_RE);
  if (!match) return { action: "continue" };

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.action === "modify") {
      return {
        action: "modify",
        reason: parsed.reason ?? undefined,
        addSteps: Array.isArray(parsed.addSteps) ? parsed.addSteps : undefined,
        removeIndices: Array.isArray(parsed.removeIndices) ? parsed.removeIndices : undefined,
        newPipeline: Array.isArray(parsed.newPipeline) ? parsed.newPipeline : undefined,
      };
    }
    return { action: "continue" };
  } catch {
    return { action: "continue" };
  }
}

// ---- Pipeline modifier ----

/**
 * Apply an adaptation to the remaining pipeline.
 * Returns the new full pipeline (completed steps preserved, remaining modified).
 */
export function applyAdaptation(
  pipeline: Array<{ agent: string; role?: string }>,
  currentIndex: number,
  adaptation: PipelineAdaptation,
): Array<{ agent: string; role?: string }> {
  if (adaptation.action === "continue") return pipeline;

  const completed = pipeline.slice(0, currentIndex + 1);
  let remaining = pipeline.slice(currentIndex + 1);

  // Remove steps by index (in reverse to preserve indices)
  if (adaptation.removeIndices && adaptation.removeIndices.length > 0) {
    const sorted = [...adaptation.removeIndices].sort((a, b) => b - a);
    for (const idx of sorted) {
      if (idx >= 0 && idx < remaining.length) {
        remaining.splice(idx, 1);
      }
    }
  }

  // Add steps at the front of remaining
  if (adaptation.addSteps && adaptation.addSteps.length > 0) {
    const newSteps = adaptation.addSteps.map((entry) => {
      const [agent, role] = entry.split(":");
      return { agent, role };
    });
    remaining = [...newSteps, ...remaining];
  }

  // Full replacement (takes precedence if provided)
  if (adaptation.newPipeline && adaptation.newPipeline.length > 0) {
    remaining = adaptation.newPipeline.map((entry) => {
      const [agent, role] = entry.split(":");
      return { agent, role };
    });
  }

  return [...completed, ...remaining];
}

/**
 * Check whether agent messages warrant a PM adaptation check.
 * Only flags and questions are considered actionable enough.
 */
export function shouldCheckAdaptation(
  messages: Array<{ type: string }>,
): boolean {
  return messages.some((m) => m.type === "flag" || m.type === "question");
}
