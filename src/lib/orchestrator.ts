/**
 * Orchestrator — the central router.
 * All agents run through Claude Code CLI (`claude -p`) or Gemini API.
 * PM is the brain — decides plan and team composition.
 *
 * Flow: User → Orchestrator → PM (plan) → [confirm] → execute pipeline → response
 */

import { prisma } from "./prisma";
import { runClaudeCode, clearLog, isAborted, resetAbort, appendLog as rawAppendLog } from "./claude-code";
import { runLLM } from "./llm";
import { getAgentRegistry, getSystemPrompt, getProviderConfig } from "./agent-loader";
import { logEvent, getEventHistory, formatEventsForPrompt } from "./event-log";
import { getSkillsForAgent, swapProjectSkills, formatSkillsForPM, formatSkillsForPrompt } from "./skills";
import { calculateCost, formatCost } from "./cost-calculator";
import { resolveProviderId, getAvailableProviders, getCheapestAvailableModel, canFallbackTo } from "./providers";
import { classifyError } from "./errors";
import { parseSettings, type ProjectSettings } from "@/types/settings";
import { writePlanFile, waitForConfirmation, cleanupPlanFiles } from "./plan-gate";
import { buildPersonalityInjection, initializeRelationships, updateRelationships, getPersonality } from "./personality";
import { queryMemories, formatMemoriesForPrompt, getMemoryTypesForAgent } from "./memory";
import { ingestDecisionFromEvent, ingestPersonalityFromAgentRun } from "./memory-ingestion";

// Helper for logging to the live UI log file (project-scoped)
function appendLog(projectId: string, text: string) {
  rawAppendLog(projectId, text);
}

// ----- Types -----

interface PipelineStep {
  agent: string;
  role?: string;
}

interface PMPlanTask {
  id: number;
  title: string;
  description: string;
  agent: string;
  role: string;
  dependsOn: number[];
  acceptanceCriteria: string[];
  provider?: string;
  model?: string;
  skills?: string[];
}

interface PMPlan {
  analysis: string;
  needsArchitect: boolean;
  tasks: PMPlanTask[];
  pipeline: string[];
}

interface StepResult {
  agent: string;
  role?: string;
  title: string;
  status: "done" | "failed";
  output: string;
}

export interface OrchestratorResult {
  response: string;
  steps: StepResult[];
  plan?: PMPlan;
  runId?: string;
}

export type ProgressEvent = {
  type: "agent_start" | "agent_done" | "agent_error" | "plan_ready" | "plan_awaiting_confirmation" | "plan_confirmed" | "plan_rejected" | "summary" | "done" | "output";
  agent?: string;
  role?: string;
  title?: string;
  message?: string;
  step?: number;
  totalSteps?: number;
  chunk?: string;
};

const MAX_FIX_CYCLES = 3;

// ----- Model auto-detection & persistence -----

/**
 * Ensure every agent in the registry has a resolved model saved in project settings.
 * - If already saved and provider still available → keep it
 * - If not saved or provider gone → resolve from frontmatter → fallback to first available → save
 */
async function resolveAndSaveAgentModels(
  projectId: string,
  settings: ProjectSettings
): Promise<ProjectSettings> {
  const providers = await getAvailableProviders();
  const registry = getAgentRegistry();
  const agents = { ...(settings.agents || {}) };
  let dirty = false;

  for (const type of Object.keys(registry)) {
    const saved = agents[type];

    // If already saved and provider still available, keep it
    if (saved?.model) {
      const pid = saved.provider ?? resolveProviderId(saved.model);
      const p = providers.find((pr) => pr.id === pid);
      if (p?.available && p.models.includes(saved.model)) continue;
    }

    // Resolve: agent frontmatter model → check if provider available → fallback
    const { provider: fmProvider, model: fmModel } = getProviderConfig(type);
    const providerInfo = providers.find((p) => p.id === fmProvider);

    let resolvedProvider: string;
    let resolvedModel: string;

    if (providerInfo?.available) {
      resolvedProvider = fmProvider;
      resolvedModel = fmModel;
    } else {
      const fallback = providers.find((p) => p.available);
      if (!fallback) continue; // no providers at all — skip
      resolvedProvider = fallback.id;
      resolvedModel = fallback.models[0];
    }

    agents[type] = {
      enabled: saved?.enabled ?? true,
      model: resolvedModel,
      provider: resolvedProvider,
      roles: saved?.roles,
    };
    dirty = true;
  }

  if (dirty) {
    const updated = { ...settings, agents };
    await prisma.project.update({
      where: { id: projectId },
      data: { settings: JSON.stringify(updated) },
    });
    return updated;
  }

  return { ...settings, agents };
}

// ----- Checkpoint helper -----

async function checkpoint(runId: string, data: Record<string, unknown>) {
  await prisma.pipelineRun.update({
    where: { runId },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
}

// ----- Main Entry -----

export async function orchestrate(opts: {
  projectId: string;
  conversationId: string;
  userMessage: string;
  runId?: string;
  resumeRunId?: string;
  onProgress?: (event: ProgressEvent) => void;
}): Promise<OrchestratorResult> {
  const { projectId, conversationId, userMessage, onProgress, resumeRunId } = opts;
  const runId = opts.runId ?? `run-${Date.now()}`;
  const emit = onProgress ?? (() => {});
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const baseSettings = parseSettings(project.settings);
  const projectSettings = await resolveAndSaveAgentModels(projectId, baseSettings);
  const steps: StepResult[] = [];

  let runningCost = 0;
  let plan: PMPlan | null = null;
  let pipeline: PipelineStep[] = [];
  let lastOutput = "";
  let fixCycle = 0;
  let startStepIndex = 0;
  let pipelineRunDbId: string | undefined;

  // ----- Resume branch -----
  if (resumeRunId) {
    const saved = await prisma.pipelineRun.findUniqueOrThrow({ where: { runId: resumeRunId } });
    pipelineRunDbId = saved.id;

    plan = saved.plan ? JSON.parse(saved.plan) as PMPlan : null;
    pipeline = saved.pipeline ? parsePipeline(JSON.parse(saved.pipeline) as string[]) : [];
    const savedSteps = saved.completedSteps ? JSON.parse(saved.completedSteps) as StepResult[] : [];
    steps.push(...savedSteps);
    lastOutput = saved.lastOutput ?? "";
    fixCycle = saved.fixCycle;
    runningCost = saved.runningCost;
    startStepIndex = saved.currentStep;

    await checkpoint(resumeRunId, { status: "running" });

    resetAbort(projectId);
    appendLog(projectId, `\n${"=".repeat(80)}\n🔄 RESUMING PIPELINE from step ${startStepIndex + 1}/${pipeline.length}\n${"=".repeat(80)}\n`);
    appendLog(projectId, `📋 Project: ${project.name}\n`);
    appendLog(projectId, `💰 Running cost so far: ${formatCost(runningCost)}\n\n`);
  } else {
    // ----- Fresh run -----
    clearLog(projectId);
    resetAbort(projectId);

    // Create PipelineRun record
    const pipelineRunRecord = await prisma.pipelineRun.create({
      data: {
        projectId,
        conversationId,
        runId,
        userMessage,
        status: "running",
      },
    });
    pipelineRunDbId = pipelineRunRecord.id;

    // Initialize agent relationships for personality system
    if (projectSettings.personalityEnabled !== false) {
      initializeRelationships(projectId).catch(() => {});
    }

    appendLog(projectId, `\n${"=".repeat(80)}\n🚀 LILIT PIPELINE STARTED\n${"=".repeat(80)}\n`);
    appendLog(projectId, `📋 Project: ${project.name}\n`);
    appendLog(projectId, `📂 Path: ${project.path}\n`);
    appendLog(projectId, `🏗️  Stack: ${projectSettings.stack || "auto-detect"}\n`);
    appendLog(projectId, `💰 Budget Limit: ${projectSettings.budgetLimit ? `$${projectSettings.budgetLimit}` : "none"}\n`);
    appendLog(projectId, `💬 Request: ${userMessage.slice(0, 200)}${userMessage.length > 200 ? "..." : ""}\n`);
    appendLog(projectId, `⏰ Started: ${new Date().toLocaleString()}\n\n`);

    // 1. Get event history for context
    appendLog(projectId, `📚 Loading project history...\n`);
    const history = await getEventHistory({ projectId, limit: 50 });
    const historyContext = formatEventsForPrompt(history);
    appendLog(projectId, `✅ Loaded ${history.length} previous events\n\n`);

    // 2. Ask PM to create a plan
    emit({ type: "agent_start", agent: "pm", title: "Creating execution plan..." });
    const conversationContext = await getConversationContext(conversationId);
    const pmPrompt = buildPMPrompt(userMessage, project.path, project.name, historyContext, conversationContext, projectSettings);
    const pmResult = await runAgent({
      agent: "pm",
      prompt: pmPrompt,
      cwd: project.path,
      projectId,
      settings: projectSettings,
      pipelineRunId: pipelineRunDbId,
    });

    if (pmResult.cost) {
      runningCost += pmResult.cost;
    }

    plan = parsePMPlan(pmResult.output);
    if (!plan) {
      // Check if PM is asking for clarification — relay through orchestrator
      const questions = parseClarification(pmResult.output);
      if (questions) {
        const formatted = questions.map(q => `- ${q}`).join("\n");
        appendLog(projectId, `\n💬 Clarification needed before proceeding:\n${formatted}\n`);
        emit({ type: "agent_done", agent: "pm", message: "Needs clarification" });
        await checkpoint(runId, { status: "completed" });
        return {
          response: `I need a few clarifications before creating a plan:\n\n${formatted}`,
          steps,
          runId,
        };
      }

      // PM produced unstructured text — could not parse a plan
      appendLog(projectId, `\n⚠️ Could not parse PM plan from output\n`);
      emit({ type: "agent_error", agent: "pm", message: "Could not parse plan" });
      await checkpoint(runId, { status: "failed", error: "Could not parse PM plan" });
      return { response: pmResult.output, steps, runId };
    }

    appendLog(projectId, `\n${"=".repeat(80)}\n📋 EXECUTION PLAN CREATED\n${"=".repeat(80)}\n`);
    appendLog(projectId, `📊 Analysis: ${plan.analysis}\n\n`);
    appendLog(projectId, `📝 Tasks (${plan.tasks.length}):\n`);
    plan.tasks.forEach((t, idx) => {
      appendLog(projectId, `  ${idx + 1}. [${t.agent}:${t.role}] ${t.title}\n`);
      appendLog(projectId, `     ${t.description.slice(0, 100)}${t.description.length > 100 ? "..." : ""}\n`);
    });
    appendLog(projectId, `\n🔄 Pipeline: ${plan.pipeline.join(" → ")}\n\n`);

    await logEvent({
      projectId,
      agent: "pm",
      type: "plan_created",
      data: { analysis: plan.analysis, pipeline: plan.pipeline, taskCount: plan.tasks.length },
    });

    steps.push({ agent: "pm", title: "Execution Plan", status: "done", output: plan.analysis });
    emit({ type: "plan_ready", agent: "pm", title: "Plan ready", message: plan.analysis });

    // Checkpoint: plan parsed, awaiting confirmation
    await checkpoint(runId, {
      plan: JSON.stringify(plan),
      pipeline: JSON.stringify(plan.pipeline),
      status: "awaiting_plan",
      runningCost,
      completedSteps: JSON.stringify(steps),
    });

    // 2.5. Plan confirmation gate
    appendLog(projectId, `\n⏳ AWAITING PLAN CONFIRMATION...\n`);
    emit({ type: "plan_awaiting_confirmation", title: "Waiting for approval..." });

    await logEvent({
      projectId,
      agent: "pm",
      type: "plan_awaiting_confirmation",
      data: { runId, plan },
    });

    writePlanFile(projectId, runId, plan);

    try {
      const confirmation = await waitForConfirmation(projectId, runId, {
        timeoutMs: 600_000, // 10 min
        pollIntervalMs: 1000,
        abortCheck: () => isAborted(projectId),
      });

      if (confirmation.action === "reject") {
        appendLog(projectId, `\n🚫 PLAN REJECTED by user\n`);
        if (confirmation.notes) appendLog(projectId, `📝 Notes: ${confirmation.notes}\n`);
        emit({ type: "plan_rejected", title: "Plan rejected" });

        await logEvent({
          projectId,
          agent: "pm",
          type: "plan_rejected",
          data: { notes: confirmation.notes },
        });

        await checkpoint(runId, { status: "failed", error: "Plan rejected by user" });

        return {
          response: `Plan rejected.${confirmation.notes ? ` Notes: ${confirmation.notes}` : ""}`,
          steps,
          plan,
          runId,
        };
      }

      appendLog(projectId, `\n✅ PLAN CONFIRMED — proceeding with execution\n\n`);
      emit({ type: "plan_confirmed", title: "Plan approved" });

      await logEvent({
        projectId,
        agent: "pm",
        type: "plan_confirmed",
        data: {},
      });

      // Checkpoint: plan confirmed, running
      await checkpoint(runId, { status: "running" });
    } catch {
      // Timeout or abort — treat as auto-confirm for backward compatibility
      appendLog(projectId, `\n⚡ Plan auto-confirmed (no response within timeout)\n\n`);
    } finally {
      cleanupPlanFiles(projectId, runId);
    }

    // Parse pipeline for execution
    pipeline = parsePipeline(plan.pipeline);
  }

  // Use the correct runId for checkpointing (could be resumeRunId)
  const activeRunId = resumeRunId ?? runId;

  if (!plan) {
    await checkpoint(activeRunId, { status: "failed", error: "No plan available" });
    return { response: "No plan available for execution.", steps, runId: activeRunId };
  }

  // 3. Execute pipeline
  appendLog(projectId, `\n${"=".repeat(80)}\n🔧 EXECUTING PIPELINE (${pipeline.length} steps, starting at ${startStepIndex + 1})\n${"=".repeat(80)}\n\n`);

  const consumedTaskIds = new Set<number>();
  for (let i = startStepIndex; i < pipeline.length; i++) {
    if (isAborted(projectId)) {
      appendLog(projectId, `\n${"=".repeat(80)}\n🛑 PIPELINE ABORTED BY USER\n${"=".repeat(80)}\n`);
      appendLog(projectId, `⏰ Aborted at: ${new Date().toLocaleString()}\n`);
      appendLog(projectId, `📊 Completed ${i}/${pipeline.length} steps before abort\n\n`);
      steps.push({
        agent: "pm",
        title: "Pipeline aborted",
        status: "failed",
        output: `Aborted by user at step ${i + 1}/${pipeline.length}`
      });
      emit({ type: "agent_error", agent: "pm", message: "Pipeline aborted by user" });

      await checkpoint(activeRunId, {
        status: "aborted",
        currentStep: i,
        completedSteps: JSON.stringify(steps),
        lastOutput,
        fixCycle,
        runningCost,
        pipeline: JSON.stringify(pipeline.map(s => s.role ? `${s.agent}:${s.role}` : s.agent)),
      });
      break;
    }
    const step = pipeline[i];
    const stepLabel = step.role ? `${step.agent}:${step.role}` : step.agent;

    // Skip steps for agents/roles disabled in project settings
    if (!isStepEnabled(step, projectSettings)) {
      appendLog(projectId, `\n⏭️  Skipping ${stepLabel} — disabled in project settings\n`);
      steps.push({
        agent: step.agent,
        role: step.role,
        title: stepLabel,
        status: "done",
        output: `Skipped — ${stepLabel} is disabled in project settings`,
      });
      emit({
        type: "agent_done",
        agent: step.agent,
        role: step.role,
        title: stepLabel,
        step: i + 1,
        totalSteps: pipeline.length,
      });
      await checkpoint(activeRunId, {
        currentStep: i + 1,
        completedSteps: JSON.stringify(steps),
        lastOutput,
        fixCycle,
        runningCost,
        pipeline: JSON.stringify(pipeline.map(s => s.role ? `${s.agent}:${s.role}` : s.agent)),
      });
      continue;
    }

    const task = plan.tasks.find(
      (t) => t.agent === step.agent && (!step.role || t.role === step.role) && !consumedTaskIds.has(t.id)
    );
    if (task) consumedTaskIds.add(task.id);

    appendLog(projectId, `\n${"─".repeat(80)}\n`);
    appendLog(projectId, `📍 STEP ${i + 1}/${pipeline.length}: ${stepLabel}\n`);
    if (task) {
      appendLog(projectId, `📌 Task: ${task.title}\n`);
      appendLog(projectId, `📝 Description: ${task.description.slice(0, 150)}${task.description.length > 150 ? "..." : ""}\n`);
    }
    appendLog(projectId, `${"─".repeat(80)}\n`);

    emit({
      type: "agent_start",
      agent: step.agent,
      role: step.role,
      title: task?.title ?? stepLabel,
      step: i + 1,
      totalSteps: pipeline.length,
    });

    const currentEvents = await getEventHistory({ projectId, limit: 50 });
    const eventsContext = formatEventsForPrompt(currentEvents);

    // RAG memory retrieval
    let memoryContext = "";
    if (projectSettings.personalityEnabled !== false) {
      try {
        const memories = await queryMemories({
          projectId,
          query: task?.description ?? userMessage,
          agent: step.agent,
          types: getMemoryTypesForAgent(step.agent, step.role),
          limit: 8,
        });
        if (memories.length > 0) {
          memoryContext = formatMemoriesForPrompt(memories);
          appendLog(projectId, `🔍 Retrieved ${memories.length} memories\n`);
        }
      } catch {
        // RAG failure is non-fatal
      }
    }

    const prompt = buildStepPrompt({
      step,
      task,
      userMessage,
      projectPath: project.path,
      eventsContext,
      lastOutput,
      plan,
      memoryContext,
    });

    const result = await runAgent({
      agent: step.agent,
      role: step.role,
      prompt,
      cwd: project.path,
      projectId,
      settings: projectSettings,
      taskHint: task ? { provider: task.provider, model: task.model, skills: task.skills } : undefined,
      pipelineRunId: pipelineRunDbId,
      memoryContext,
    });

    // Track cost and check budget
    if (result.cost) {
      runningCost += result.cost;

      if (projectSettings.budgetLimit && runningCost > projectSettings.budgetLimit) {
        appendLog(projectId, `\n💰 BUDGET LIMIT EXCEEDED: $${runningCost.toFixed(2)} > $${projectSettings.budgetLimit}\n`);
        steps.push({
          agent: "pm",
          title: "Budget limit exceeded",
          status: "failed",
          output: `Budget limit of $${projectSettings.budgetLimit} exceeded (current: $${runningCost.toFixed(2)})`
        });

        await checkpoint(activeRunId, {
          status: "aborted",
          currentStep: i,
          completedSteps: JSON.stringify(steps),
          lastOutput,
          fixCycle,
          runningCost,
          error: "Budget limit exceeded",
          pipeline: JSON.stringify(pipeline.map(s => s.role ? `${s.agent}:${s.role}` : s.agent)),
        });
        break;
      }
    }

    // Check abort after agent runs
    if (isAborted(projectId)) {
      appendLog(projectId, `\n🛑 Abort detected after agent execution\n`);
      steps.push({
        agent: "pm",
        title: "Pipeline aborted",
        status: "failed",
        output: `Aborted during ${stepLabel} execution`
      });

      await checkpoint(activeRunId, {
        status: "aborted",
        currentStep: i,
        completedSteps: JSON.stringify(steps),
        lastOutput,
        fixCycle,
        runningCost,
        pipeline: JSON.stringify(pipeline.map(s => s.role ? `${s.agent}:${s.role}` : s.agent)),
      });
      break;
    }

    const eventType = getEventType(step);
    const eventRecord = await logEvent({
      projectId,
      taskId: task ? String(task.id) : undefined,
      agent: step.agent,
      role: step.role,
      type: eventType,
      data: { summary: result.output.slice(0, 2000), success: result.success },
    });

    // Post-step memory ingestion + relationship updates (fire-and-forget)
    if (projectSettings.personalityEnabled !== false) {
      ingestDecisionFromEvent(
        projectId, eventRecord.id, eventType, step.agent, step.role,
        { summary: result.output.slice(0, 2000), success: result.success }
      ).catch(() => {});
      ingestPersonalityFromAgentRun(
        projectId, eventRecord.id, step.agent, step.role, result.output
      ).catch(() => {});
      updateRelationships(projectId, step, result).catch(() => {});
    }

    const stepResult: StepResult = {
      agent: step.agent,
      role: step.role,
      title: task?.title ?? stepLabel,
      status: result.success ? "done" : "failed",
      output: result.output,
    };
    steps.push(stepResult);

    emit({
      type: result.success ? "agent_done" : "agent_error",
      agent: step.agent,
      role: step.role,
      title: stepResult.title,
      message: result.success ? undefined : result.output.slice(0, 500),
      step: i + 1,
      totalSteps: pipeline.length,
    });

    lastOutput = result.output;

    // Check if QA/review failed → feedback loop through PM
    if (!result.success || isFailure(step, result.output)) {
      appendLog(projectId, `\n⚠️  FAILURE DETECTED in ${stepLabel}\n`);
      appendLog(projectId, `📊 Fix cycle: ${fixCycle + 1}/${MAX_FIX_CYCLES}\n`);

      if (fixCycle >= MAX_FIX_CYCLES) {
        appendLog(projectId, `\n🚫 Maximum fix cycles (${MAX_FIX_CYCLES}) reached. Stopping pipeline.\n`);
        steps.push({
          agent: "pm",
          title: "Max fix cycles reached",
          status: "failed",
          output: `Reached ${MAX_FIX_CYCLES} fix attempts. Stopping.`,
        });
        break;
      }

      appendLog(projectId, `🔄 Asking PM to re-evaluate and create fix plan...\n`);
      const reEvalPrompt = buildReEvalPrompt(step, result.output, eventsContext, userMessage);
      const reEvalResult = await runAgent({
        agent: "pm",
        prompt: reEvalPrompt,
        cwd: project.path,
        projectId,
        settings: projectSettings,
        pipelineRunId: pipelineRunDbId,
      });

      if (reEvalResult.cost) {
        runningCost += reEvalResult.cost;
      }

      const fixPlan = parsePMPlan(reEvalResult.output);

      if (fixPlan) {
        appendLog(projectId, `✅ Fix plan created: ${fixPlan.pipeline.join(" → ")}\n`);
        appendLog(projectId, `📋 Injecting ${fixPlan.pipeline.length} fix steps into pipeline\n\n`);

        await logEvent({
          projectId,
          agent: "pm",
          type: "feedback_routed",
          data: { reason: "step_failed", step: `${step.agent}:${step.role}`, fixPipeline: fixPlan.pipeline },
        });

        const fixSteps = parsePipeline(fixPlan.pipeline);
        pipeline.splice(i + 1, 0, ...fixSteps);
        fixCycle++;
      } else {
        appendLog(projectId, `❌ Could not parse fix plan from PM. Continuing...\n\n`);
      }
    }

    // Checkpoint after each step
    await checkpoint(activeRunId, {
      currentStep: i + 1,
      completedSteps: JSON.stringify(steps),
      lastOutput,
      fixCycle,
      runningCost,
      pipeline: JSON.stringify(pipeline.map(s => s.role ? `${s.agent}:${s.role}` : s.agent)),
    });
  }

  // 4. Generate summary
  appendLog(projectId, `\n${"=".repeat(80)}\n📝 GENERATING SUMMARY\n${"=".repeat(80)}\n`);
  emit({ type: "summary", title: "Generating summary..." });
  const summary = await generateSummary(userMessage, steps);

  appendLog(projectId, `\n${"=".repeat(80)}\n✨ PIPELINE COMPLETE\n${"=".repeat(80)}\n`);
  appendLog(projectId, `⏰ Finished: ${new Date().toLocaleString()}\n`);
  appendLog(projectId, `📊 Total steps: ${steps.length}\n`);
  appendLog(projectId, `✅ Successful: ${steps.filter(s => s.status === "done").length}\n`);
  appendLog(projectId, `❌ Failed: ${steps.filter(s => s.status === "failed").length}\n`);
  appendLog(projectId, `💰 Total cost: ${formatCost(runningCost)}\n\n`);

  // Final checkpoint
  await checkpoint(activeRunId, {
    status: "completed",
    runningCost,
    completedSteps: JSON.stringify(steps),
  });

  emit({ type: "done", message: "Pipeline complete" });
  return { response: summary, steps, plan, runId: activeRunId };
}

// ----- Agent Runner -----

interface ExecuteOnceResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  tokensUsed?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
}

async function executeOnce(opts: {
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
}): Promise<ExecuteOnceResult> {
  const agentLabel = opts.role ? `${opts.agent}:${opts.role}` : opts.agent;

  if (opts.provider === "gemini") {
    appendLog(opts.projectId, `🌐 Using Gemini API (no tool access)\n\n`);
    const result = await runLLM({
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      agentLabel,
    });
    const costUsd = result.tokensUsed ? calculateCost(opts.model, result.tokensUsed) : undefined;
    if (result.tokensUsed) {
      appendLog(opts.projectId, `💰 Cost: ${formatCost(costUsd!)} (${result.tokensUsed.inputTokens}in/${result.tokensUsed.outputTokens}out)\n`);
    }
    return {
      success: result.success,
      output: result.text,
      error: result.success ? undefined : result.text,
      durationMs: result.durationMs,
      tokensUsed: result.tokensUsed,
      costUsd,
    };
  }

  // Claude Code CLI path
  const stack = opts.settings?.stack ?? "";
  const skills = opts.taskHint?.skills?.length
    ? opts.taskHint.skills
    : getSkillsForAgent(opts.agent, opts.role, stack);
  appendLog(opts.projectId, `🧰 Loading skills: ${skills.join(", ") || "none"}${opts.taskHint?.skills?.length ? " (PM-assigned)" : ""}\n`);
  await swapProjectSkills(opts.cwd, skills);
  appendLog(opts.projectId, `🚀 Using Claude Code CLI (file access + tools)\n\n`);

  const promptWithSkills = formatSkillsForPrompt(skills) + opts.prompt;

  const result = await runClaudeCode({
    prompt: promptWithSkills,
    cwd: opts.cwd,
    projectId: opts.projectId,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    agentLabel,
  });
  const costUsd = result.tokensUsed ? calculateCost(opts.model, result.tokensUsed) : undefined;
  if (result.tokensUsed) {
    appendLog(opts.projectId, `💰 Cost: ${formatCost(costUsd!)} (${result.tokensUsed.inputTokens}in/${result.tokensUsed.outputTokens}out)\n`);
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

const MAX_AGENT_ATTEMPTS = 3;

async function runAgent(opts: {
  agent: string;
  role?: string;
  prompt: string;
  cwd: string;
  projectId: string;
  settings?: ProjectSettings;
  taskHint?: { provider?: string; model?: string; skills?: string[] };
  pipelineRunId?: string;
  memoryContext?: string;
}): Promise<{ success: boolean; output: string; cost?: number }> {
  let systemPrompt = getSystemPrompt(opts.agent, opts.role);

  // Personality injection
  if (opts.settings?.personalityEnabled !== false) {
    const personality = getPersonality(opts.agent);
    if (personality) {
      appendLog(opts.projectId, `🧠 Personality: ${personality.codename} (${opts.role ? `${opts.agent}:${opts.role}` : opts.agent})\n`);
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

  // Provider resolution chain:
  // 1. Project settings override
  // 2. PM plan task-level hint
  // 3. Role .md frontmatter
  // 4. Agent .md frontmatter
  // 5. Auto-select by model prefix
  let { provider, model } = getProviderConfig(opts.agent, opts.role);

  // Task-level hint from PM plan (Phase 7)
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
      // Role-level override
      if (opts.role && agentSettings.roles?.[opts.role]?.model) {
        model = agentSettings.roles[opts.role].model!;
        provider = agentSettings.roles[opts.role].provider ?? resolveProviderId(model);
      }
    }
  }

  // Auto-fallback: if resolved provider isn't available, switch to one that is
  const providers = await getAvailableProviders();
  const resolvedProvider = providers.find((p) => p.id === provider);
  if (!resolvedProvider?.available) {
    const fallback = providers.find((p) => p.available && canFallbackTo(opts.agent, p));
    if (fallback) {
      const oldProvider = provider;
      const oldModel = model;
      provider = fallback.id;
      model = fallback.models[0];
      appendLog(opts.projectId, `\n⚠️  ${oldProvider} unavailable, falling back to ${provider}/${model} (was ${oldModel})\n`);
    }
  }

  const agentLabel = opts.role ? `${opts.agent}:${opts.role}` : opts.agent;

  appendLog(opts.projectId, `\n🔧 Provider: ${provider} | Model: ${model}\n`);
  appendLog(opts.projectId, `📏 Prompt length: ${opts.prompt.length} chars\n`);

  let currentProvider = provider;
  let currentModel = model;
  let totalCost = 0;
  let lastOutput = "";

  for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt++) {
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
    });

    // Record each attempt as an AgentRun
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
        tokensUsed: result.tokensUsed ? result.tokensUsed.inputTokens + result.tokensUsed.outputTokens : null,
        costUsd: result.costUsd,
      },
    });

    if (result.costUsd) totalCost += result.costUsd;
    lastOutput = result.output;

    if (result.success) {
      return { success: true, output: result.output, cost: totalCost };
    }

    // Classify error
    const kind = classifyError(result.error ?? result.output);

    if (kind === "permanent") {
      appendLog(opts.projectId, `\n[${agentLabel}] Permanent error — not retryable\n`);
      break;
    }

    if (attempt === 1) {
      // Retry same provider after delay
      appendLog(opts.projectId, `\n[${agentLabel}] Transient error — retrying ${currentProvider} in 2s...\n`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (attempt === 2) {
      // Try cross-provider fallback
      const refreshedProviders = await getAvailableProviders(true);
      const fallback = refreshedProviders.find(
        p => p.id !== currentProvider && p.available && canFallbackTo(opts.agent, p)
      );
      if (fallback) {
        appendLog(opts.projectId, `\n[${agentLabel}] Switching: ${currentProvider} -> ${fallback.id}/${fallback.models[0]}\n`);

        await logEvent({
          projectId: opts.projectId,
          agent: opts.agent,
          role: opts.role,
          type: "provider_fallback",
          data: {
            fromProvider: currentProvider,
            toProvider: fallback.id,
            reason: result.error ?? "execution failed",
          },
        });

        currentProvider = fallback.id;
        currentModel = fallback.models[0];
        continue;
      }
      appendLog(opts.projectId, `\n[${agentLabel}] No capable fallback provider available\n`);
      break;
    }
  }

  return { success: false, output: lastOutput, cost: totalCost };
}

// ----- Prompt Builders -----

async function getConversationContext(conversationId: string): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { role: true, content: true },
  });

  if (messages.length === 0) return "No previous messages.";

  return messages
    .reverse()
    .map((m) => {
      if (m.role === "user") return `[User] ${m.content}`;
      // Assistant responses can be long — just show the beginning
      const text = m.content.length > 300 ? m.content.slice(0, 300) + "..." : m.content;
      return `[Assistant] ${text}`;
    })
    .join("\n\n");
}

function buildPMPrompt(
  userMessage: string,
  projectPath: string,
  projectName: string,
  historyContext: string,
  conversationContext: string,
  settings?: ProjectSettings,
): string {
  // Inject available agents list, filtering out disabled ones
  const registry = getAgentRegistry();
  const agentsList = Object.values(registry)
    .filter((a) => settings?.agents[a.type]?.enabled !== false)
    .map((a) => {
      const agentRoles = settings?.agents[a.type]?.roles;
      const roles = Object.keys(a.roles).filter(
        (r) => agentRoles?.[r]?.enabled !== false
      );
      return `- ${a.name} (${a.type}): ${a.description}${roles.length > 0 ? ` [roles: ${roles.join(", ")}]` : ""}`;
    })
    .join("\n");

  const skillsList = formatSkillsForPM();

  return `## Project
Name: ${projectName}
Path: ${projectPath}

## Available Agents
${agentsList}

## Available Skills
${skillsList}

## Conversation History
${conversationContext}

## Event History
${historyContext}

## User Request
${userMessage}

Create an execution plan following the Markdown format from your instructions.`;
}

function buildStepPrompt(opts: {
  step: PipelineStep;
  task?: PMPlanTask;
  userMessage: string;
  projectPath: string;
  eventsContext: string;
  lastOutput: string;
  plan: PMPlan;
  memoryContext?: string;
}): string {
  const { step, task, userMessage, projectPath, eventsContext, lastOutput, plan, memoryContext } = opts;

  let prompt = `## Project: ${projectPath}\n\n`;

  if (memoryContext) {
    prompt += `## Relevant Memories\n${memoryContext}\n\n`;
  }

  prompt += `## Event History\n${eventsContext}\n\n`;
  prompt += `## Original User Request\n${userMessage}\n\n`;

  if (step.agent === "architect") {
    prompt += `## Your Task\nDefine the architecture and tech stack for this project.\n`;
    prompt += `Output your architecture spec as a JSON block.\n`;
  } else if (task) {
    prompt += `## Your Task\n**${task.title}**\n${task.description}\n\n`;
    prompt += `## Acceptance Criteria\n${(task.acceptanceCriteria ?? []).map((c) => `- ${c}`).join("\n")}\n\n`;
  }

  if (step.role === "review" && lastOutput) {
    prompt += `## Code Changes to Review (from Developer)\n${lastOutput.slice(0, 5000)}\n\n`;
    prompt += `Review this code objectively. Output JSON as specified in your instructions.\n`;
  }

  if (step.role === "fix" && lastOutput) {
    prompt += `## Issues to Fix\n${lastOutput.slice(0, 5000)}\n\n`;
    prompt += `Fix these issues. Report what you changed.\n`;
  }

  if (step.agent === "qa" && step.role === "automation") {
    prompt += `## PM's Task Plan\n${JSON.stringify(plan.tasks, null, 2)}\n\n`;
    prompt += `Write and run tests based on the acceptance criteria. Output JSON as specified.\n`;
  }

  return prompt;
}

function buildReEvalPrompt(
  failedStep: PipelineStep,
  failOutput: string,
  eventsContext: string,
  userMessage: string
): string {
  return `## Situation
Step "${failedStep.agent}${failedStep.role ? `:${failedStep.role}` : ""}" failed or found issues.

## Failed Step Output
${failOutput.slice(0, 3000)}

## Event History
${eventsContext}

## Original Request
${userMessage}

Re-evaluate and create a fix plan following your re-evaluation Markdown format.`;
}

// ----- Summary Generator -----

async function generateSummary(
  userMessage: string,
  steps: StepResult[],
): Promise<string> {
  const stepsSummary = steps
    .map((s) => {
      const who = s.role ? `${s.agent}:${s.role}` : s.agent;
      return `[${who}] (${s.status}): ${s.output.slice(0, 500)}`;
    })
    .join("\n\n");

  const prompt = `Summarize the development work for the user. Be concise and clear.
Show: what was done, key files changed, any issues found and resolved.
Format with markdown. Keep it under 400 words.

## Request
${userMessage}

## Work Done
${stepsSummary}`;

  const summaryModel = await getCheapestAvailableModel();
  const result = await runLLM({
    prompt,
    systemPrompt: "You are a technical writer. Summarize development work clearly and concisely. Output ONLY the summary text, no code changes.",
    model: summaryModel.model,
    agentLabel: "summary",
  });

  return result.text || "Pipeline completed. Check steps for details.";
}

// ----- Parsers & Helpers -----

function parsePMPlan(raw: string): PMPlan | null {
  // Clarification response — not a plan
  if (raw.includes("## Clarification Needed")) return null;

  // Extract analysis (initial plan) or action (re-eval fix plan) section
  const analysisMatch = raw.match(/## (?:Analysis|Action)\s*\n([\s\S]*?)(?=\n## |$)/);
  const analysis = analysisMatch?.[1]?.trim() ?? "";

  // Extract pipeline — required
  const pipelineMatch = raw.match(/## Pipeline\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!pipelineMatch) return null;

  const pipelineLine = pipelineMatch[1].trim().split("\n")[0].trim();
  const pipeline = pipelineLine.split(/\s*→\s*/).filter(Boolean);
  if (pipeline.length === 0) return null;

  // Extract tasks — required
  const tasksMatch = raw.match(/## Tasks\s*\n([\s\S]*?)$/);
  if (!tasksMatch) return null;

  const taskBlocks = tasksMatch[1].split(/### \d+\.\s+/).filter(Boolean);

  const tasks: PMPlanTask[] = taskBlocks.map((block, idx) => {
    const title = block.split("\n")[0]?.trim() ?? `Task ${idx + 1}`;
    const agent = block.match(/- Agent:\s*(.+)/)?.[1]?.trim() ?? "developer";
    const role = block.match(/- Role:\s*(.+)/)?.[1]?.trim() ?? "code";
    const description = block.match(/- Description:\s*(.+)/)?.[1]?.trim() ?? title;
    const skills = block.match(/- Skills:\s*(.+)/)?.[1]?.split(",").map(s => s.trim()).filter(Boolean);
    const provider = block.match(/- Provider:\s*(.+)/)?.[1]?.trim();
    const model = block.match(/- Model:\s*(.+)/)?.[1]?.trim();

    // Acceptance criteria: indented bullet points after "Acceptance Criteria:"
    const acMatch = block.match(/- Acceptance Criteria:\s*\n((?:\s+-[^\n]+\n?)*)/);
    const acceptanceCriteria = acMatch
      ? (acMatch[1].match(/\s+-\s+(.+)/g) ?? []).map(l => l.replace(/^\s+-\s+/, "").trim())
      : [];

    return {
      id: idx + 1,
      title,
      agent,
      role,
      description,
      skills,
      provider,
      model,
      acceptanceCriteria,
      dependsOn: [],
    };
  });

  if (tasks.length === 0) return null;

  return {
    analysis,
    needsArchitect: pipeline.some(s => s.startsWith("architect")),
    tasks,
    pipeline,
  };
}

function parseClarification(raw: string): string[] | null {
  const match = raw.match(/## Clarification Needed\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!match) return null;

  const questions = match[1]
    .split("\n")
    .map(line => line.replace(/^-\s+/, "").trim())
    .filter(Boolean);

  return questions.length > 0 ? questions : null;
}

function parsePipeline(pipeline: string[]): PipelineStep[] {
  return pipeline.map((entry) => {
    const [agent, role] = entry.split(":");
    return { agent, role };
  });
}

// Map-based event type resolver with fallback
const EVENT_TYPE_MAP: Record<string, Record<string, string>> = {
  architect: { "": "architecture_defined" },
  developer: {
    code: "code_written",
    review: "review_done",
    fix: "fix_applied",
    devops: "devops_configured",
  },
  qa: {
    automation: "tests_written",
    manual: "browser_tested",
  },
};

function getEventType(step: PipelineStep): string {
  const agentMap = EVENT_TYPE_MAP[step.agent];
  if (agentMap) {
    return agentMap[step.role ?? ""] ?? "task_completed";
  }
  return "task_completed";
}

/**
 * Check if a pipeline step's agent (and role) is enabled in project settings.
 * Agents not present in settings are assumed enabled (backward compat).
 */
function isStepEnabled(step: PipelineStep, settings: ProjectSettings): boolean {
  const agentSettings = settings.agents[step.agent];
  if (!agentSettings) return true; // not configured — default enabled
  if (agentSettings.enabled === false) return false;
  if (step.role && agentSettings.roles?.[step.role]?.enabled === false) return false;
  return true;
}

function isFailure(step: PipelineStep, output: string): boolean {
  // First try structured JSON detection (most reliable)
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      if (data.approved === false) return true;
      if (data.passed === false) return true;
      if (data.approved === true || data.passed === true) return false;
    }
  } catch { /* not JSON */ }

  if (step.agent === "qa") {
    const lower = output.toLowerCase();
    if (output.includes("🔴")) return true;
    const failMatch = lower.match(/(\d+)\s+fail/);
    if (failMatch && parseInt(failMatch[1]) > 0) return true;
    return false;
  }
  if (step.role === "review") {
    return output.includes('"approved": false') || output.includes("🔴");
  }
  return false;
}
