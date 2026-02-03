/**
 * Orchestrator — the central router.
 * All agents run through provider adapters (Claude Code CLI, Gemini API, Anthropic API).
 * PM is the brain — decides plan and team composition.
 *
 * Flow: User → Orchestrator → PM (plan) → [confirm] → execute pipeline → response
 *
 * Two execution modes:
 * - Dynamic orchestration (default): PM decision loop with task graph
 * - Sequential pipeline (legacy): for-loop with hardcoded fix cycles
 */

import { prisma } from "./prisma";
import { clearLog, isAborted, resetAbort, appendLog as rawAppendLog } from "./claude-code";
import { getAgentRegistry, getProviderConfig } from "./agent-loader";
import { logEvent, getEventHistory, formatEventsForPrompt } from "./event-log";
import { formatCost } from "./cost-calculator";
import { resolveProviderId, getAvailableProviders } from "./providers/index";
import { parseSettings, type ProjectSettings } from "@/types/settings";
import { writePlanFile, waitForConfirmation, cleanupPlanFiles } from "./plan-gate";
import { initializeRelationships, updateRelationships } from "./personality";
import { queryMemories, formatMemoriesForPrompt, getMemoryTypesForAgent } from "./memory";
import { ingestDecisionFromEvent, ingestPersonalityFromAgentRun } from "./memory-ingestion";
import { generateStandup, type StandupResult } from "./standup";
import { getMessageInstructions, extractMessages, storeMessages, getInboxMessages, formatInboxForPrompt, getAllMessages } from "./agent-messages";
import { buildAdaptationPrompt, parseAdaptation, applyAdaptation, shouldCheckAdaptation, type AdaptationRecord } from "./pipeline-adaptation";
import { evaluateDebateTriggers, runDebateRound, storeDebateRound, ingestDebateMemory, updateDebateRelationships, type DebateRoundResult } from "./debate";
import { ensurePersonalities } from "./personality-bootstrap";
import { AGENT, REQUIRED_AGENTS } from "@/lib/models";
import {
  MAX_FIX_CYCLES,
  EVENT_HISTORY_LIMIT,
  PLAN_CONFIRMATION_TIMEOUT_MS,
  PLAN_POLL_INTERVAL_MS,
  RAG_MEMORY_LIMIT,
} from "@/lib/constants";

// Extracted modules
import {
  runAgent,
  generateSummary,
  stepLabel,
  isStepEnabled,
  getEventType,
  isFailure,
} from "./agent-runner";
import {
  getConversationContext,
  buildPMPrompt,
  buildStepPrompt,
  buildReEvalPrompt,
  parsePMPlan,
  parseConversationalResponse,
  parseClarification,
  parsePipeline,
  type PMPlanTask,
  type PMPlan,
  type StepResult,
  type PipelineStep,
} from "./prompt-builders";
import { runPMDecisionLoop } from "./pm-decision-loop";
import type { TaskGraph, TaskNode } from "@/types/task-graph";
import crypto from "crypto";

// Re-export for consumers
export { stepLabel };

// Helper for logging to the live UI log file (project-scoped)
function appendLog(projectId: string, text: string) {
  rawAppendLog(projectId, text);
}

// ----- Types -----

export interface OrchestratorResult {
  response: string;
  steps: StepResult[];
  plan?: PMPlan;
  runId?: string;
  standup?: StandupResult;
  agentMessages?: Array<{
    id: string;
    fromAgent: string;
    toAgent: string;
    messageType: string;
    content: string;
    phase: number;
    createdAt: string;
  }>;
  adaptations?: Array<{
    afterStep: number;
    reason?: string;
    addedSteps?: string[];
    removedSteps?: number[];
    costUsd: number;
  }>;
  debates?: Array<{
    challengerAgent: string;
    defenderAgent: string;
    triggerOpinion: string;
    outcome: string;
    turnCount: number;
    resolutionNote?: string;
    costUsd: number;
    stepIndex: number;
  }>;
}

import type { PipelineProgressEvent } from "@/types/pipeline";

// Keep backward-compatible export name
export type ProgressEvent = PipelineProgressEvent;


// ----- Task persistence helpers -----

/** Create Task records in the DB from a PM plan. */
async function createTasksFromPlan(
  projectId: string,
  pipelineRunId: string,
  tasks: PMPlanTask[],
): Promise<Map<number, string>> {
  const planIdToDbId = new Map<number, string>();
  for (const t of tasks) {
    const record = await prisma.task.create({
      data: {
        projectId,
        pipelineRunId,
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        skills: t.skills ?? [],
        assignedAgent: t.agent,
        assignedRole: t.role,
        provider: t.provider,
        model: t.model,
        status: "assigned",
        sequenceOrder: t.id,
        graphId: `t${t.id}`,
        dependsOn: t.dependsOn.map((d) => `t${d}`),
      },
    });
    planIdToDbId.set(t.id, record.id);
  }
  return planIdToDbId;
}

/** Transition a task to in_progress. */
async function markTaskInProgress(taskDbId: string) {
  await prisma.task.update({
    where: { id: taskDbId },
    data: { status: "in_progress", startedAt: new Date() },
  });
}

/** Transition a task to done or failed, storing its output. */
async function markTaskComplete(
  taskDbId: string,
  status: "done" | "failed",
  output: string,
  costUsd: number,
) {
  await prisma.task.update({
    where: { id: taskDbId },
    data: {
      status,
      output,
      outputSummary: output.slice(0, 500),
      costUsd,
      completedAt: new Date(),
    },
  });
}

/** Load existing task DB ID map for a resumed pipeline run. */
async function loadTaskMap(pipelineRunId: string): Promise<Map<number, string>> {
  const tasks = await prisma.task.findMany({
    where: { pipelineRunId },
    select: { id: true, sequenceOrder: true },
    orderBy: { sequenceOrder: "asc" },
  });
  const map = new Map<number, string>();
  for (const t of tasks) {
    map.set(t.sequenceOrder, t.id);
  }
  return map;
}

// ----- Model auto-detection & persistence -----

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

    if (saved?.model) {
      const pid = saved.provider ?? resolveProviderId(saved.model);
      const p = providers.find((pr) => pr.id === pid);
      if (p?.available && p.models.includes(saved.model)) continue;
    }

    const { provider: fmProvider, model: fmModel } = getProviderConfig(type);
    const providerInfo = providers.find((p) => p.id === fmProvider);

    let resolvedProvider: string;
    let resolvedModel: string;

    if (providerInfo?.available) {
      resolvedProvider = fmProvider;
      resolvedModel = fmModel;
    } else {
      const fallback = providers.find((p) => p.available);
      if (!fallback) continue;
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

// ----- Build task graph from PM plan -----

function buildTaskGraph(plan: PMPlan): TaskGraph {
  const tasks: Record<string, TaskNode> = {};

  for (const t of plan.tasks) {
    const id = `t${t.id}`;
    const depIds = t.dependsOn.map((d) => `t${d}`);

    // A task is "ready" if all its dependencies are already resolved
    // Since we build from scratch, only tasks with no deps are ready
    const isReady = depIds.length === 0;

    tasks[id] = {
      id,
      title: t.title,
      description: t.description,
      agent: t.agent,
      role: t.role,
      dependsOn: depIds,
      acceptanceCriteria: t.acceptanceCriteria,
      skills: t.skills,
      provider: t.provider,
      model: t.model,
      status: isReady ? "ready" : "pending",
      attempts: 0,
      addedBy: "initial",
    };
  }

  return { tasks };
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
  const adaptations: AdaptationRecord[] = [];
  const allDebates: DebateRoundResult[] = [];
  const agentSessionIds = new Map<string, string>();
  let taskMap = new Map<number, string>();

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

    taskMap = await loadTaskMap(pipelineRunDbId);

    resetAbort(projectId);
    appendLog(projectId, `\n${"=".repeat(80)}\n🔄 RESUMING PIPELINE from step ${startStepIndex + 1}/${pipeline.length}\n${"=".repeat(80)}\n`);
    appendLog(projectId, `📋 Project: ${project.name}\n`);
    appendLog(projectId, `💰 Running cost so far: ${formatCost(runningCost)}\n\n`);
  } else {
    // ----- Fresh run -----
    clearLog(projectId);
    resetAbort(projectId);

    const existing = await prisma.pipelineRun.findUnique({ where: { runId } });
    if (existing) {
      pipelineRunDbId = existing.id;
    } else {
      const created = await prisma.pipelineRun.create({
        data: { projectId, conversationId, runId, userMessage, status: "running" },
      });
      pipelineRunDbId = created.id;
    }

    if (projectSettings.personalityEnabled !== false) {
      initializeRelationships(projectId).catch(() => {});
      const allAgentTypes = Object.keys(getAgentRegistry());
      ensurePersonalities(projectId, allAgentTypes).catch(() => {});
    }

    appendLog(projectId, `\n${"=".repeat(80)}\n🚀 LILIT PIPELINE STARTED\n${"=".repeat(80)}\n`);
    appendLog(projectId, `📋 Project: ${project.name}\n`);
    appendLog(projectId, `📂 Path: ${project.path}\n`);
    appendLog(projectId, `🏗️  Stack: ${projectSettings.stack || "auto-detect"}\n`);
    appendLog(projectId, `💰 Budget Limit: ${projectSettings.budgetLimit ? `$${projectSettings.budgetLimit}` : "none"}\n`);
    appendLog(projectId, `🧠 Orchestration: ${projectSettings.dynamicOrchestration !== false ? "dynamic (PM decision loop)" : "sequential (legacy)"}\n`);
    appendLog(projectId, `💬 Request: ${userMessage.slice(0, 200)}${userMessage.length > 200 ? "..." : ""}\n`);
    appendLog(projectId, `⏰ Started: ${new Date().toLocaleString()}\n\n`);

    const registry = getAgentRegistry();
    for (const required of REQUIRED_AGENTS) {
      if (!registry[required]) {
        const error = `Required agent "${required}" not found. Ensure agents/${required}/AGENT.md exists.`;
        appendLog(projectId, `\n❌ ${error}\n`);
        await checkpoint(runId, { status: "failed", error });
        return { response: error, steps, runId };
      }
    }

    // 1. Get event history
    appendLog(projectId, `📚 Loading project history...\n`);
    const history = await getEventHistory({ projectId, limit: EVENT_HISTORY_LIMIT });
    const historyContext = formatEventsForPrompt(history);
    appendLog(projectId, `✅ Loaded ${history.length} previous events\n\n`);

    // 2. Ask PM to create a plan
    emit({ type: "agent_start", agent: AGENT.PM, title: "Creating execution plan..." });
    const conversationContext = await getConversationContext(conversationId);
    const pmPrompt = await buildPMPrompt(userMessage, project.path, project.name, historyContext, conversationContext, projectSettings, projectId);
    const pmResult = await runAgent({
      agent: AGENT.PM,
      prompt: pmPrompt,
      cwd: project.path,
      projectId,
      settings: projectSettings,
      pipelineRunId: pipelineRunDbId,
    });

    if (pmResult.cost) {
      runningCost += pmResult.cost;
    }

    if (isAborted(projectId)) {
      appendLog(projectId, `\n🛑 Pipeline stopped by user during planning\n`);
      emit({ type: "agent_done", agent: AGENT.PM, message: "Stopped by user" });
      await checkpoint(runId, { status: "aborted" });
      return { response: "Pipeline stopped.", steps, runId };
    }

    const conversationalResponse = parseConversationalResponse(pmResult.output);
    if (conversationalResponse) {
      appendLog(projectId, `\n💬 PM responded conversationally (no pipeline needed)\n`);
      emit({ type: "agent_done", agent: AGENT.PM, message: "Conversational response" });
      await checkpoint(runId, { status: "completed" });
      return { response: conversationalResponse, steps, runId };
    }

    plan = parsePMPlan(pmResult.output);
    if (!plan) {
      const questions = parseClarification(pmResult.output);
      if (questions) {
        const formatted = questions.map(q => `- ${q}`).join("\n");
        appendLog(projectId, `\n💬 Clarification needed before proceeding:\n${formatted}\n`);
        emit({ type: "agent_done", agent: AGENT.PM, message: "Needs clarification" });
        await checkpoint(runId, { status: "completed" });
        return {
          response: `I need a few clarifications before creating a plan:\n\n${formatted}`,
          steps,
          runId,
        };
      }

      appendLog(projectId, `\n⚠️ Could not parse PM plan from output\n`);
      emit({ type: "agent_error", agent: AGENT.PM, message: "Could not parse plan" });
      await checkpoint(runId, { status: "failed", error: "Could not parse PM plan" });
      return { response: pmResult.output, steps, runId };
    }

    appendLog(projectId, `\n${"=".repeat(80)}\n📋 EXECUTION PLAN CREATED\n${"=".repeat(80)}\n`);
    appendLog(projectId, `📊 Analysis: ${plan.analysis}\n\n`);
    appendLog(projectId, `📝 Tasks (${plan.tasks.length}):\n`);
    plan.tasks.forEach((t, idx) => {
      const deps = t.dependsOn.length > 0 ? ` (depends on: ${t.dependsOn.join(", ")})` : "";
      appendLog(projectId, `  ${idx + 1}. [${t.agent}:${t.role}] ${t.title}${deps}\n`);
      appendLog(projectId, `     ${t.description.slice(0, 100)}${t.description.length > 100 ? "..." : ""}\n`);
    });
    appendLog(projectId, `\n🔄 Pipeline: ${plan.pipeline.join(" → ")}\n\n`);

    await logEvent({
      projectId,
      agent: AGENT.PM,
      type: "plan_created",
      data: { analysis: plan.analysis, pipeline: plan.pipeline, taskCount: plan.tasks.length },
    });

    steps.push({ agent: AGENT.PM, title: "Execution Plan", status: "done", output: plan.analysis });
    emit({ type: "plan_ready", agent: AGENT.PM, title: "Plan ready", message: plan.analysis });

    // Create Task records in DB
    if (pipelineRunDbId) {
      try {
        taskMap = await createTasksFromPlan(projectId, pipelineRunDbId, plan.tasks);
        appendLog(projectId, `📋 Created ${taskMap.size} task record(s)\n`);
      } catch {
        // Non-fatal
      }
    }

    // Checkpoint
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
      agent: AGENT.PM,
      type: "plan_awaiting_confirmation",
      data: { runId, plan },
    });

    writePlanFile(projectId, runId, plan);

    try {
      const confirmation = await waitForConfirmation(projectId, runId, {
        timeoutMs: PLAN_CONFIRMATION_TIMEOUT_MS,
        pollIntervalMs: PLAN_POLL_INTERVAL_MS,
        abortCheck: () => isAborted(projectId),
      });

      if (confirmation.action === "reject") {
        appendLog(projectId, `\n🚫 PLAN REJECTED by user\n`);
        if (confirmation.notes) appendLog(projectId, `📝 Notes: ${confirmation.notes}\n`);
        emit({ type: "plan_rejected", title: "Plan rejected" });

        await logEvent({
          projectId,
          agent: AGENT.PM,
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
        agent: AGENT.PM,
        type: "plan_confirmed",
        data: {},
      });

      await checkpoint(runId, { status: "running" });
    } catch {
      appendLog(projectId, `\n⚡ Plan auto-confirmed (no response within timeout)\n\n`);
    } finally {
      cleanupPlanFiles(projectId, runId);
    }

    pipeline = parsePipeline(plan.pipeline);
  }

  const activeRunId = resumeRunId ?? runId;

  if (!plan) {
    await checkpoint(activeRunId, { status: "failed", error: "No plan available" });
    return { response: "No plan available for execution.", steps, runId: activeRunId };
  }

  // ===== EXECUTION BRANCH =====
  // Dynamic orchestration (PM decision loop) vs Sequential pipeline (legacy)

  if (projectSettings.dynamicOrchestration !== false) {
    // ---- Dynamic orchestration: PM decision loop ----
    appendLog(projectId, `\n${"=".repeat(80)}\n🧠 DYNAMIC ORCHESTRATION — PM DECISION LOOP\n${"=".repeat(80)}\n\n`);

    const graph = buildTaskGraph(plan);

    // Save initial graph
    await checkpoint(activeRunId, { taskGraph: JSON.stringify(graph) });

    const loopResult = await runPMDecisionLoop({
      projectId,
      conversationId,
      graph,
      settings: projectSettings,
      pipelineRunDbId: pipelineRunDbId!,
      runId: activeRunId,
      project: { path: project.path, name: project.name },
      userMessage,
      plan,
      onProgress: emit,
    });

    steps.push(...loopResult.steps);
    runningCost += loopResult.cost;
    allDebates.push(...loopResult.debates);
  } else {
    // ---- Sequential pipeline (legacy) ----
    appendLog(projectId, `\n${"=".repeat(80)}\n🔧 EXECUTING PIPELINE (${pipeline.length} steps, starting at ${startStepIndex + 1})\n${"=".repeat(80)}\n\n`);

    const consumedTaskIds = new Set<number>();
    for (let i = startStepIndex; i < pipeline.length; i++) {
      if (isAborted(projectId)) {
        appendLog(projectId, `\n${"=".repeat(80)}\n🛑 PIPELINE ABORTED BY USER\n${"=".repeat(80)}\n`);
        appendLog(projectId, `⏰ Aborted at: ${new Date().toLocaleString()}\n`);
        appendLog(projectId, `📊 Completed ${i}/${pipeline.length} steps before abort\n\n`);
        steps.push({
          agent: AGENT.PM,
          title: "Pipeline aborted",
          status: "failed",
          output: `Aborted by user at step ${i + 1}/${pipeline.length}`
        });
        emit({ type: "agent_error", agent: AGENT.PM, message: "Pipeline aborted by user" });

        await checkpoint(activeRunId, {
          status: "aborted",
          currentStep: i,
          completedSteps: JSON.stringify(steps),
          lastOutput,
          fixCycle,
          runningCost,
          pipeline: JSON.stringify(pipeline.map(stepLabel)),
        });
        break;
      }
      const step = pipeline[i];
      const label = stepLabel(step);

      if (!isStepEnabled(step, projectSettings)) {
        appendLog(projectId, `\n⏭️  Skipping ${label} — disabled in project settings\n`);
        steps.push({
          agent: step.agent,
          role: step.role,
          title: label,
          status: "done",
          output: `Skipped — ${label} is disabled in project settings`,
        });
        emit({
          type: "agent_done",
          agent: step.agent,
          role: step.role,
          title: label,
          step: i + 1,
          totalSteps: pipeline.length,
        });
        await checkpoint(activeRunId, {
          currentStep: i + 1,
          completedSteps: JSON.stringify(steps),
          lastOutput,
          fixCycle,
          runningCost,
          pipeline: JSON.stringify(pipeline.map(stepLabel)),
        });
        continue;
      }

      const task = plan.tasks.find(
        (t) => t.agent === step.agent && (!step.role || t.role === step.role) && !consumedTaskIds.has(t.id)
      );
      if (task) consumedTaskIds.add(task.id);

      const taskDbId = task ? taskMap.get(task.id) : undefined;
      if (taskDbId) {
        try { await markTaskInProgress(taskDbId); } catch { /* non-fatal */ }
      }

      appendLog(projectId, `\n${"─".repeat(80)}\n`);
      appendLog(projectId, `📍 STEP ${i + 1}/${pipeline.length}: ${label}\n`);
      if (task) {
        appendLog(projectId, `📌 Task: ${task.title}\n`);
        appendLog(projectId, `📝 Description: ${task.description.slice(0, 150)}${task.description.length > 150 ? "..." : ""}\n`);
      }
      appendLog(projectId, `${"─".repeat(80)}\n`);

      emit({
        type: "agent_start",
        agent: step.agent,
        role: step.role,
        title: task?.title ?? label,
        step: i + 1,
        totalSteps: pipeline.length,
      });

      const currentEvents = await getEventHistory({ projectId, limit: EVENT_HISTORY_LIMIT });
      const eventsContext = formatEventsForPrompt(currentEvents);

      let memoryContext = "";
      if (projectSettings.personalityEnabled !== false) {
        try {
          const memories = await queryMemories({
            projectId,
            query: task?.description ?? userMessage,
            agent: step.agent,
            types: getMemoryTypesForAgent(),
            limit: RAG_MEMORY_LIMIT,
          });
          if (memories.length > 0) {
            memoryContext = formatMemoriesForPrompt(memories);
            appendLog(projectId, `🔍 Retrieved ${memories.length} memories\n`);
          }
        } catch {
          // Non-fatal
        }
      }

      let inboxContext = "";
      let messageInstructions = "";
      if (pipelineRunDbId) {
        try {
          const inbox = await getInboxMessages({
            pipelineRunId: pipelineRunDbId,
            toAgent: step.agent,
          });
          if (inbox.length > 0) {
            inboxContext = formatInboxForPrompt(inbox, projectSettings.voiceEnabled === true);
            appendLog(projectId, `📨 ${inbox.length} message(s) in inbox for ${label}\n`);
          }
          const otherAgents = [...new Set(pipeline.map((s) => s.agent))];
          messageInstructions = getMessageInstructions(step.agent, otherAgents);
        } catch {
          // Non-fatal
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
        inboxContext,
        messageInstructions,
      });

      const sessionKey = stepLabel(step);
      if (!agentSessionIds.has(sessionKey)) {
        agentSessionIds.set(sessionKey, crypto.randomUUID());
      }
      const sessionId = agentSessionIds.get(sessionKey)!;

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
        sessionId,
      });

      // Extract inter-agent messages
      if (pipelineRunDbId && result.output) {
        try {
          const { cleanOutput, messages } = extractMessages(result.output);
          if (messages.length > 0) {
            const stored = await storeMessages({
              pipelineRunId: pipelineRunDbId,
              fromAgent: step.agent,
              fromRole: step.role,
              phase: i,
              messages,
            });
            appendLog(projectId, `📤 ${stored.length} message(s) sent to other agents\n`);
            for (const msg of stored) {
              appendLog(projectId, `   → ${msg.toAgent}: [${msg.messageType}] ${msg.content.slice(0, 100)}${msg.content.length > 100 ? "..." : ""}\n`);
            }
            emit({
              type: "agent_message",
              agent: step.agent,
              message: `${messages.length} message(s) sent`,
            });
            result.output = cleanOutput;
          }
        } catch {
          // Non-fatal
        }
      }

      // Debate trigger evaluation
      const debateEnabled = projectSettings.personalityEnabled !== false &&
        projectSettings.debateEnabled !== false;

      if (debateEnabled && pipelineRunDbId && result.output) {
        try {
          const conflicts = await evaluateDebateTriggers({
            projectId,
            pipelineRunId: pipelineRunDbId,
            stepIndex: i,
            step,
            stepOutput: result.output,
            settings: projectSettings,
            runningCost,
            budgetLimit: projectSettings.budgetLimit,
            debatesThisRun: allDebates.length,
          });

          for (const conflict of conflicts) {
            appendLog(projectId, `\n\uD83D\uDCAC DEBATE: ${conflict.challengerAgent} challenges ${conflict.defenderAgent}\n`);
            appendLog(projectId, `   Opinion: "${conflict.triggerOpinion.slice(0, 100)}"\n`);

            const round = await runDebateRound({
              conflict,
              pipelineRunId: pipelineRunDbId,
              projectId,
              stepIndex: i,
            });

            for (const turn of round.turns) {
              appendLog(projectId, `   [${turn.agent}] (${turn.messageType}): ${turn.content.slice(0, 200)}\n`);
            }
            appendLog(projectId, `   Outcome: ${round.outcome}\n\n`);

            await storeDebateRound(round);
            await ingestDebateMemory(projectId, round);
            await updateDebateRelationships(projectId, round);

            runningCost += round.costUsd;
            allDebates.push(round);
          }
        } catch {
          // Non-fatal
        }
      }

      // Adaptive pipeline
      if (
        projectSettings.adaptivePipelineEnabled &&
        pipelineRunDbId &&
        i < pipeline.length - 1
      ) {
        try {
          const recentMsgs = await getAllMessages(pipelineRunDbId);
          const thisStepMsgs = recentMsgs.filter((m) => m.phase === i);
          if (thisStepMsgs.length > 0 && shouldCheckAdaptation(thisStepMsgs.map((m) => ({ type: m.messageType })))) {
            appendLog(projectId, `\n🔄 Adaptive pipeline: PM evaluating ${thisStepMsgs.length} agent message(s)...\n`);

            const remainingLabels = pipeline.slice(i + 1).map(stepLabel);
            const adaptPrompt = buildAdaptationPrompt({
              currentStepIndex: i,
              completedStepLabel: stepLabel(step),
              completedSteps: steps.map((s) => ({
                agent: s.agent,
                role: s.role,
                title: s.title,
                status: s.status,
              })),
              remainingPipeline: remainingLabels,
              agentMessages: thisStepMsgs.map((m) => ({
                fromAgent: m.fromAgent,
                toAgent: m.toAgent,
                type: m.messageType,
                content: m.content,
              })),
              userMessage,
            });

            const adaptResult = await runAgent({
              agent: AGENT.PM,
              prompt: adaptPrompt,
              cwd: project.path,
              projectId,
              settings: projectSettings,
              pipelineRunId: pipelineRunDbId,
            });

            if (adaptResult.cost) runningCost += adaptResult.cost;

            const adaptation = parseAdaptation(adaptResult.output);

            if (adaptation.action === "modify") {
              const oldLen = pipeline.length;
              pipeline = applyAdaptation(pipeline, i, adaptation);
              const diff = pipeline.length - oldLen;

              adaptations.push({
                afterStep: i,
                adaptation,
                triggeredBy: thisStepMsgs.map((m) => m.id),
                costUsd: adaptResult.cost ?? 0,
              });

              appendLog(projectId, `🔀 Pipeline adapted: ${adaptation.reason ?? "PM modification"}\n`);
              if (diff > 0) appendLog(projectId, `   +${diff} step(s) added\n`);
              if (diff < 0) appendLog(projectId, `   ${diff} step(s) removed\n`);
              appendLog(projectId, `   New pipeline: ${pipeline.slice(i + 1).map(stepLabel).join(" → ")}\n`);

              emit({
                type: "pipeline_adapted",
                agent: AGENT.PM,
                message: adaptation.reason ?? "Pipeline modified",
                step: i + 1,
                totalSteps: pipeline.length,
              });

              await logEvent({
                projectId,
                agent: AGENT.PM,
                type: "pipeline_adapted",
                data: { afterStep: i, adaptation, newPipelineLength: pipeline.length },
              });
            } else {
              appendLog(projectId, `✅ PM: No pipeline changes needed\n`);
            }
          }
        } catch {
          // Non-fatal
        }
      }

      if (result.cost) {
        runningCost += result.cost;

        if (projectSettings.budgetLimit && runningCost > projectSettings.budgetLimit) {
          appendLog(projectId, `\n💰 BUDGET LIMIT EXCEEDED: $${runningCost.toFixed(2)} > $${projectSettings.budgetLimit}\n`);
          steps.push({
            agent: AGENT.PM,
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
            pipeline: JSON.stringify(pipeline.map(stepLabel)),
          });
          break;
        }
      }

      if (isAborted(projectId)) {
        appendLog(projectId, `\n🛑 Abort detected after agent execution\n`);
        steps.push({
          agent: AGENT.PM,
          title: "Pipeline aborted",
          status: "failed",
          output: `Aborted during ${label} execution`
        });

        await checkpoint(activeRunId, {
          status: "aborted",
          currentStep: i,
          completedSteps: JSON.stringify(steps),
          lastOutput,
          fixCycle,
          runningCost,
          pipeline: JSON.stringify(pipeline.map(stepLabel)),
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

      if (projectSettings.personalityEnabled !== false) {
        ingestDecisionFromEvent(
          projectId, eventRecord.id, eventType, step.agent, step.role,
          { summary: result.output.slice(0, 2000), success: result.success }
        ).catch(() => {});
        ingestPersonalityFromAgentRun(
          projectId, eventRecord.id, step.agent, step.role, result.output
        ).catch(() => {});
        updateRelationships(projectId, step, result, pipeline, i).catch(() => {});
      }

      const stepResult: StepResult = {
        agent: step.agent,
        role: step.role,
        title: task?.title ?? label,
        status: result.success ? "done" : "failed",
        output: result.output,
      };
      steps.push(stepResult);

      if (taskDbId) {
        try {
          await markTaskComplete(taskDbId, stepResult.status, result.output, result.cost ?? 0);
        } catch { /* non-fatal */ }
      }

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

      if (!result.success || isFailure(step, result.output)) {
        appendLog(projectId, `\n⚠️  FAILURE DETECTED in ${label}\n`);
        appendLog(projectId, `📊 Fix cycle: ${fixCycle + 1}/${MAX_FIX_CYCLES}\n`);

        if (fixCycle >= MAX_FIX_CYCLES) {
          appendLog(projectId, `\n🚫 Maximum fix cycles (${MAX_FIX_CYCLES}) reached. Stopping pipeline.\n`);
          steps.push({
            agent: AGENT.PM,
            title: "Max fix cycles reached",
            status: "failed",
            output: `Reached ${MAX_FIX_CYCLES} fix attempts. Stopping.`,
          });
          break;
        }

        appendLog(projectId, `🔄 Asking PM to re-evaluate and create fix plan...\n`);
        const reEvalPrompt = buildReEvalPrompt(step, result.output, eventsContext, userMessage);
        const reEvalResult = await runAgent({
          agent: AGENT.PM,
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
            agent: AGENT.PM,
            type: "feedback_routed",
            data: { reason: "step_failed", step: `${step.agent}:${step.role}`, fixPipeline: fixPlan.pipeline },
          });

          const fixSteps = parsePipeline(fixPlan.pipeline);
          pipeline.splice(i + 1, 0, ...fixSteps);
          fixCycle++;

          if (pipelineRunDbId && fixPlan.tasks.length > 0) {
            try {
              const fixTaskMap = await createTasksFromPlan(projectId, pipelineRunDbId, fixPlan.tasks);
              for (const [planId, dbId] of fixTaskMap) {
                taskMap.set(planId, dbId);
              }
            } catch { /* non-fatal */ }
          }
        } else {
          appendLog(projectId, `❌ Could not parse fix plan from PM. Continuing...\n\n`);
        }
      }

      await checkpoint(activeRunId, {
        currentStep: i + 1,
        completedSteps: JSON.stringify(steps),
        lastOutput,
        fixCycle,
        runningCost,
        pipeline: JSON.stringify(pipeline.map(stepLabel)),
      });
    }
  }

  // 4. Generate summary
  appendLog(projectId, `\n${"=".repeat(80)}\n📝 GENERATING SUMMARY\n${"=".repeat(80)}\n`);
  emit({ type: "summary", title: "Generating summary..." });
  const summary = await generateSummary(userMessage, steps);

  // 4.5 Generate team standup
  let standupResult: StandupResult | undefined;
  const pipelineWasAborted = steps.some(s => s.output.includes("Aborted"));
  if (!pipelineWasAborted && pipelineRunDbId && plan) {
    try {
      appendLog(projectId, `\n${"=".repeat(80)}\n🗣️  GENERATING TEAM STANDUP\n${"=".repeat(80)}\n`);
      standupResult = await generateStandup({
        pipelineRunId: pipelineRunDbId,
        projectId,
        userMessage,
        steps,
        plan,
        fixCycleCount: fixCycle,
        totalCost: runningCost,
        settings: projectSettings,
        debates: allDebates,
      });

      if (standupResult.messages.length > 0) {
        const insights = standupResult.messages.filter(m => m.insightType !== "none");
        const noTension = standupResult.messages.length - insights.length;
        appendLog(projectId, `✅ Standup complete: ${insights.length} insight(s), ${noTension} agent(s) reported no tensions\n`);
        runningCost += standupResult.totalCost;
      } else {
        appendLog(projectId, `ℹ️  No standup messages generated\n`);
      }
    } catch {
      appendLog(projectId, `⚠️  Standup generation failed (non-blocking)\n`);
    }
  }

  appendLog(projectId, `\n${"=".repeat(80)}\n✨ PIPELINE COMPLETE\n${"=".repeat(80)}\n`);
  appendLog(projectId, `⏰ Finished: ${new Date().toLocaleString()}\n`);
  appendLog(projectId, `📊 Total steps: ${steps.length}\n`);
  appendLog(projectId, `✅ Successful: ${steps.filter(s => s.status === "done").length}\n`);
  appendLog(projectId, `❌ Failed: ${steps.filter(s => s.status === "failed").length}\n`);
  appendLog(projectId, `💰 Total cost: ${formatCost(runningCost)}\n\n`);

  await checkpoint(activeRunId, {
    status: "completed",
    runningCost,
    completedSteps: JSON.stringify(steps),
  });

  let agentMessages: OrchestratorResult["agentMessages"];
  if (pipelineRunDbId) {
    try {
      const allMsgs = await getAllMessages(pipelineRunDbId);
      if (allMsgs.length > 0) {
        agentMessages = allMsgs.map((m) => ({
          id: m.id,
          fromAgent: m.fromAgent,
          toAgent: m.toAgent,
          messageType: m.messageType,
          content: m.content,
          phase: m.phase,
          createdAt: m.createdAt.toISOString(),
        }));
      }
    } catch {}
  }

  emit({ type: "done", message: "Pipeline complete" });

  const adaptationResults = adaptations.length > 0
    ? adaptations.map((a) => ({
        afterStep: a.afterStep,
        reason: a.adaptation.reason,
        addedSteps: a.adaptation.addSteps,
        removedSteps: a.adaptation.removeIndices,
        costUsd: a.costUsd,
      }))
    : undefined;

  const debateResults = allDebates.length > 0
    ? allDebates.map((d) => ({
        challengerAgent: d.challengerAgent,
        defenderAgent: d.defenderAgent,
        triggerOpinion: d.triggerOpinion,
        outcome: d.outcome,
        turnCount: d.turns.length,
        resolutionNote: d.resolutionNote,
        costUsd: d.costUsd,
        stepIndex: d.stepIndex,
      }))
    : undefined;

  return { response: summary, steps, plan, runId: activeRunId, standup: standupResult, agentMessages, adaptations: adaptationResults, debates: debateResults };
}
