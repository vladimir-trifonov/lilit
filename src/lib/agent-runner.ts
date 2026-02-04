/**
 * Agent runner — extracted from orchestrator.ts.
 *
 * Handles single agent execution with provider resolution, retry logic,
 * personality injection, skill loading, and cross-provider fallback.
 */

import { prisma } from "./prisma";
import { appendLog as rawAppendLog, isAborted } from "./claude-code";
import { getAgent, getSystemPrompt, getProviderConfig } from "./agent-loader";
import { logEvent } from "./event-log";
import { calculateCost, formatCost } from "./cost-calculator";
import {
  getAdapter,
  resolveProviderId,
  getAvailableProviders,
  canFallbackTo,
  getCheapestAvailableModel,
} from "./providers/index";
import { classifyError } from "./errors";
import { getSkillsForAgent, swapProjectSkills, formatSkillsForPrompt } from "./skills";
import {
  buildPersonalityInjection,
  getPersonality,
} from "./personality";
import type { ProjectSettings } from "@/types/settings";
import {
  MAX_AGENT_ATTEMPTS,
  TRANSIENT_RETRY_DELAY_MS,
  STEP_OUTPUT_SUMMARY_LENGTH,
  SUMMARY_MAX_WORDS,
} from "@/lib/constants";
import crypto from "crypto";
import path from "path";
import { CREW_APP_ROOT } from "@/lib/constants";

function appendLog(projectId: string, text: string) {
  rawAppendLog(projectId, text);
}

/** Format a step as "agent:role" or just "agent" if no role. */
export function stepLabel(step: { agent: string; role?: string }): string {
  return step.role ? `${step.agent}:${step.role}` : step.agent;
}

// ----- Types -----

export interface ExecuteOnceResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  tokensUsed?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
}

export interface RunAgentResult {
  success: boolean;
  output: string;
  cost?: number;
}

// ----- Single execution -----

export async function executeOnce(opts: {
  provider: string;
  model: string;
  agent: string;
  role?: string;
  prompt: string;
  cwd: string;
  projectId: string;
  systemPrompt: string;
  settings?: ProjectSettings;
  taskHint?: { provider?: string; model?: string; skills?: string[] };
  sessionId?: string;
}): Promise<ExecuteOnceResult> {
  const resolvedCwd = path.resolve(path.normalize(opts.cwd));
  if (
    resolvedCwd === CREW_APP_ROOT ||
    CREW_APP_ROOT.startsWith(resolvedCwd + path.sep)
  ) {
    throw new Error(
      `Refusing to execute agent in app directory: ${resolvedCwd} overlaps with ${CREW_APP_ROOT}`,
    );
  }

  const agentLabel = stepLabel(opts);
  const adapter = getAdapter(opts.provider);

  let prompt = opts.prompt;

  // Skill injection for file-access providers
  if (adapter.capabilities.fileAccess) {
    const freshProject = await prisma.project.findUnique({
      where: { id: opts.projectId },
      select: { stack: true },
    });
    const stack = freshProject?.stack ?? opts.settings?.stack ?? "";
    const skills = opts.taskHint?.skills?.length
      ? opts.taskHint.skills
      : getSkillsForAgent(opts.agent, opts.role, stack);
    appendLog(
      opts.projectId,
      `🧰 Loading skills: ${skills.join(", ") || "none"}${opts.taskHint?.skills?.length ? " (PM-assigned)" : ""}\n`,
    );
    await swapProjectSkills(opts.cwd, skills);
    appendLog(opts.projectId, `🚀 Using ${adapter.name} (file access + tools)\n\n`);
    prompt = formatSkillsForPrompt(skills) + prompt;
  } else {
    appendLog(opts.projectId, `🌐 Using ${adapter.name} (no tool access)\n\n`);
  }

  const result = await adapter.execute({
    prompt,
    systemPrompt: opts.systemPrompt,
    model: opts.model,
    cwd: opts.cwd,
    projectId: opts.projectId,
    agentLabel,
    sessionId: opts.sessionId,
    enableTools: true,
  });

  const costUsd = result.tokensUsed
    ? calculateCost(opts.model, result.tokensUsed)
    : undefined;
  if (result.tokensUsed) {
    appendLog(
      opts.projectId,
      `💰 Cost: ${formatCost(costUsd!)} (${result.tokensUsed.inputTokens}in/${result.tokensUsed.outputTokens}out)\n`,
    );
  }

  return {
    success: result.success,
    output: result.output,
    error: result.error,
    durationMs: result.durationMs,
    tokensUsed: result.tokensUsed,
    costUsd,
  };
}

// ----- Agent execution with retries -----

export async function runAgent(opts: {
  agent: string;
  role?: string;
  prompt: string;
  cwd: string;
  projectId: string;
  settings?: ProjectSettings;
  taskHint?: { provider?: string; model?: string; skills?: string[] };
  pipelineRunId?: string;
  memoryContext?: string;
  sessionId?: string;
}): Promise<RunAgentResult> {
  let systemPrompt = getSystemPrompt(opts.agent, opts.role);

  // Personality injection
  if (opts.settings?.personalityEnabled !== false) {
    const personality = getPersonality(opts.agent);
    if (personality) {
      appendLog(
        opts.projectId,
        `🧠 Personality: ${personality.codename} (${stepLabel(opts)})\n`,
      );
    }

    try {
      const personalityBlock = await buildPersonalityInjection({
        projectId: opts.projectId,
        agentType: opts.agent,
        role: opts.role,
        currentContext: opts.prompt.slice(0, 500),
        memoryContext: opts.memoryContext,
      });
      if (personalityBlock) {
        systemPrompt = systemPrompt + "\n\n" + personalityBlock;
      }
    } catch {
      // Personality injection failure is non-fatal
    }
  }

  // Provider resolution chain
  let { provider, model } = getProviderConfig(opts.agent, opts.role);

  // Task-level hint from PM plan
  if (opts.taskHint?.model) {
    model = opts.taskHint.model;
    provider = opts.taskHint.provider ?? resolveProviderId(model);
  }

  // Project settings override (highest priority)
  if (opts.settings) {
    const agentSettings = opts.settings.agents[opts.agent];
    if (agentSettings) {
      if (agentSettings.model) {
        model = agentSettings.model;
        provider = agentSettings.provider ?? resolveProviderId(model);
      }
      if (opts.role && agentSettings.roles?.[opts.role]?.model) {
        model = agentSettings.roles[opts.role].model!;
        provider =
          agentSettings.roles[opts.role].provider ?? resolveProviderId(model);
      }
    }
  }

  // Auto-fallback if resolved provider unavailable
  const providers = await getAvailableProviders();
  const resolvedProvider = providers.find((p) => p.id === provider);
  if (!resolvedProvider?.available) {
    const fallback = providers.find(
      (p) => p.available && canFallbackTo(opts.agent, p),
    );
    if (fallback) {
      const oldProvider = provider;
      const oldModel = model;
      provider = fallback.id;
      model = fallback.models[0];
      appendLog(
        opts.projectId,
        `\n⚠️  ${oldProvider} unavailable, falling back to ${provider}/${model} (was ${oldModel})\n`,
      );
    }
  }

  const agentLabel = stepLabel(opts);

  appendLog(opts.projectId, `\n🔧 Provider: ${provider} | Model: ${model}\n`);
  appendLog(opts.projectId, `📏 Prompt length: ${opts.prompt.length} chars\n`);

  let currentProvider = provider;
  let currentModel = model;
  let totalCost = 0;
  let lastOutput = "";

  for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt++) {
    if (attempt > 1 && isAborted(opts.projectId)) {
      appendLog(
        opts.projectId,
        `\n🛑 [${agentLabel}] Skipped — pipeline aborted\n`,
      );
      break;
    }

    const attemptSessionId =
      attempt === 1 ? opts.sessionId : crypto.randomUUID();

    const result = await executeOnce({
      provider: currentProvider,
      model: currentModel,
      agent: opts.agent,
      role: opts.role,
      prompt: opts.prompt,
      cwd: opts.cwd,
      projectId: opts.projectId,
      systemPrompt,
      settings: opts.settings,
      taskHint: opts.taskHint,
      sessionId: attemptSessionId,
    });

    await prisma.agentRun.create({
      data: {
        projectId: opts.projectId,
        pipelineRunId: opts.pipelineRunId,
        agent: opts.agent,
        role: opts.role,
        model: currentModel,
        input: opts.prompt.slice(0, 10000),
        output: result.output.slice(0, 50000),
        status: result.success ? "completed" : "failed",
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed
          ? result.tokensUsed.inputTokens + result.tokensUsed.outputTokens
          : null,
        costUsd: result.costUsd,
      },
    });

    if (result.costUsd) totalCost += result.costUsd;
    lastOutput = result.output;

    if (result.success) {
      return { success: true, output: result.output, cost: totalCost };
    }

    if (isAborted(opts.projectId)) {
      appendLog(opts.projectId, `\n🛑 [${agentLabel}] Aborted\n`);
      break;
    }

    const kind = classifyError(result.error ?? result.output);

    if (kind === "permanent") {
      appendLog(
        opts.projectId,
        `\n[${agentLabel}] Permanent error — not retryable\n`,
      );
      break;
    }

    if (attempt === 1) {
      appendLog(
        opts.projectId,
        `\n[${agentLabel}] Transient error — retrying ${currentProvider} in 2s...\n`,
      );
      await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
      continue;
    }

    if (attempt === 2) {
      const refreshedProviders = await getAvailableProviders(true);
      const fb = refreshedProviders.find(
        (p) =>
          p.id !== currentProvider &&
          p.available &&
          canFallbackTo(opts.agent, p),
      );
      if (fb) {
        appendLog(
          opts.projectId,
          `\n[${agentLabel}] Switching: ${currentProvider} -> ${fb.id}/${fb.models[0]}\n`,
        );

        await logEvent({
          projectId: opts.projectId,
          agent: opts.agent,
          role: opts.role,
          type: "provider_fallback",
          data: {
            fromProvider: currentProvider,
            toProvider: fb.id,
            reason: result.error ?? "execution failed",
          },
        });

        currentProvider = fb.id;
        currentModel = fb.models[0];
        continue;
      }
      appendLog(
        opts.projectId,
        `\n[${agentLabel}] No capable fallback provider available\n`,
      );
      break;
    }
  }

  return { success: false, output: lastOutput, cost: totalCost };
}

// ----- Summary generator -----

export async function generateSummary(
  userMessage: string,
  steps: { agent: string; role?: string; title: string; status: string; output: string }[],
  cwd: string,
): Promise<string> {
  const stepsSummary = steps
    .map((s) => {
      const who = stepLabel(s);
      return `[${who}] (${s.status}): ${s.output.slice(0, STEP_OUTPUT_SUMMARY_LENGTH)}`;
    })
    .join("\n\n");

  const prompt = `Summarize the development work for the user. Be concise and clear.
Show: what was done, key files changed, any issues found and resolved.
Format with markdown. Keep it under ${SUMMARY_MAX_WORDS} words.

## Request
${userMessage}

## Work Done
${stepsSummary}`;

  const summaryModel = await getCheapestAvailableModel();
  const adapter = getAdapter(summaryModel.provider);
  const result = await adapter.execute({
    prompt,
    systemPrompt:
      "You are a technical writer. Summarize development work clearly and concisely. Output ONLY the summary text, no code changes.",
    model: summaryModel.model,
    cwd,
    agentLabel: "summary",
  });

  return result.output || "Pipeline completed. Check steps for details.";
}

// ----- Helpers shared with orchestrator -----

/**
 * Check if a pipeline step's agent (and role) is enabled in project settings.
 */
export function isStepEnabled(
  step: { agent: string; role?: string },
  settings: ProjectSettings,
): boolean {
  const agentSettings = settings.agents[step.agent];
  if (!agentSettings) return true;
  if (agentSettings.enabled === false) return false;
  if (step.role && agentSettings.roles?.[step.role]?.enabled === false)
    return false;
  return true;
}

/**
 * Determine event type from step agent/role definition.
 */
export function getEventType(step: { agent: string; role?: string }): string {
  const agentDef = getAgent(step.agent);
  if (!agentDef) return "task_completed";
  if (step.role && agentDef.roles[step.role]?.eventType) {
    return agentDef.roles[step.role].eventType!;
  }
  return agentDef.eventType ?? "task_completed";
}

/**
 * Detect structured pass/fail in agent output.
 */
export function isFailure(
  step: { agent: string; role?: string },
  output: string,
): boolean {
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      if (data.approved === false) return true;
      if (data.passed === false) return true;
      if (data.approved === true || data.passed === true) return false;
    }
  } catch {
    /* not JSON */
  }

  const agentDef = getAgent(step.agent);
  const roleDef = step.role ? agentDef?.roles[step.role] : undefined;
  if (roleDef?.producesPassFail) {
    if (output.includes("\uD83D\uDD34")) return true;
    const lower = output.toLowerCase();
    const failMatch = lower.match(/(\d+)\s+fail/);
    if (failMatch && parseInt(failMatch[1]) > 0) return true;
    if (output.includes('"approved": false')) return true;
  }

  return false;
}
