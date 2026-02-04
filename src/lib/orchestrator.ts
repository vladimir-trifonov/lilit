/**
 * Orchestrator — the central router.
 * All agents run through provider adapters (Claude Code CLI, Gemini API, Anthropic API).
 * PM is the brain — decides plan and team composition.
 *
 * Flow: User → Orchestrator → PM (plan) → [confirm] → execute pipeline → response
 *
 * Execution: Dynamic orchestration — PM decision loop with task graph.
 */

import fs from "fs";
import { prisma } from "./prisma";
import { clearLog, isAborted, resetAbort, appendLog as rawAppendLog, getLogFile } from "./claude-code";
import { getAgentRegistry, getProviderConfig } from "./agent-loader";
import { logEvent, getEventHistory, formatEventsForPrompt } from "./event-log";
import { formatCost } from "./cost-calculator";
import { resolveProviderId, getAvailableProviders, getBestAvailableModel } from "./providers/index";
import { parseSettings, type ProjectSettings } from "@/types/settings";
import { writePlanFile, waitForConfirmation, cleanupPlanFiles } from "./plan-gate";
import { initializeRelationships } from "./personality";
import { generateStandup, type StandupResult } from "./standup";
import { getAllMessages } from "./agent-messages";
import type { DebateRoundResult } from "./debate";
import { ensurePersonalities } from "./personality-bootstrap";
import { AGENT, REQUIRED_AGENTS } from "@/lib/models";
import {
  EVENT_HISTORY_LIMIT,
  PLAN_CONFIRMATION_TIMEOUT_MS,
  PLAN_POLL_INTERVAL_MS,
  LOG_CONTENT_MAX_LENGTH,
} from "@/lib/constants";

// Extracted modules
import {
  runAgent,
  generateSummary,
  stepLabel,
} from "./agent-runner";
import {
  getConversationContext,
  buildPMPrompt,
  parsePMOutput,
  type PMPlanTask,
  type PMPlan,
  type StepResult,
} from "./prompt-builders";
import { runPMDecisionLoop } from "./pm-decision-loop";
import { prepareGraphForResume } from "./task-graph-engine";
import type { TaskGraph, TaskNode, DecisionTrigger } from "@/types/task-graph";

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
type TaskStore = Pick<typeof prisma.task, "create" | "deleteMany">;
type ProjectStore = Pick<typeof prisma.project, "update" | "findUniqueOrThrow">;
type PipelineRunStore = Pick<typeof prisma.pipelineRun, "update" | "findUnique" | "create">;

interface OrchestratorStores {
  task: TaskStore;
  project: ProjectStore;
  pipelineRun: PipelineRunStore;
}

const DEFAULT_STORES: OrchestratorStores = {
  task: prisma.task,
  project: prisma.project,
  pipelineRun: prisma.pipelineRun,
};

async function createTasksFromPlan(
  stores: OrchestratorStores,
  projectId: string,
  pipelineRunId: string,
  tasks: PMPlanTask[],
): Promise<Map<number, string>> {
  const planIdToDbId = new Map<number, string>();
  for (const t of tasks) {
    const record = await stores.task.create({
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

// ----- Model auto-detection & persistence -----

async function resolveAndSaveAgentModels(
  stores: OrchestratorStores,
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
    await stores.project.update({
      where: { id: projectId },
      data: { settings: JSON.stringify(updated) },
    });
    return updated;
  }

  return { ...settings, agents };
}

// ----- Checkpoint helper -----

async function checkpoint(
  stores: OrchestratorStores,
  runId: string,
  data: Record<string, unknown>,
  projectId?: string
) {
  const isTerminal = ["completed", "failed", "aborted"].includes(data.status as string);
  let logData: Record<string, unknown> = {};
  if (isTerminal && projectId) {
    try {
      const logFile = getLogFile(projectId);
      if (fs.existsSync(logFile)) {
        let log = fs.readFileSync(logFile, "utf-8");
        if (log.length > LOG_CONTENT_MAX_LENGTH) {
          log = log.slice(log.length - LOG_CONTENT_MAX_LENGTH);
        }
        logData = { logContent: log };
      }
    } catch {}
  }
  await stores.pipelineRun.update({
    where: { runId },
    data: {
      ...data,
      ...logData,
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
  resume?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  stores?: OrchestratorStores;
}): Promise<OrchestratorResult> {
  const { projectId, conversationId, userMessage, onProgress } = opts;
  const stores = opts.stores ?? DEFAULT_STORES;
  const runId = opts.runId ?? `run-${Date.now()}`;
  const emit = onProgress ?? (() => {});
  const project = await stores.project.findUniqueOrThrow({ where: { id: projectId } });
  const baseSettings = parseSettings(project.settings);
  const projectSettings = await resolveAndSaveAgentModels(stores, projectId, baseSettings);
  const steps: StepResult[] = [];

  let runningCost = 0;
  let plan: PMPlan | null = null;
  let pipelineRunDbId: string | undefined;
  const allDebates: DebateRoundResult[] = [];
  let taskMap = new Map<number, string>();
  let resumedGraph: TaskGraph | null = null;
  let resumeTrigger: DecisionTrigger | null = null;

  if (opts.resume) {
    // ----- Resume path: load state from DB, skip planning -----
    resetAbort(projectId);

    const existing = await stores.pipelineRun.findUnique({ where: { runId } });
    if (!existing || !existing.plan) {
      const error = "Cannot resume: pipeline run has no saved plan";
      appendLog(projectId, `\n❌ ${error}\n`);
      return { response: error, steps, runId };
    }

    pipelineRunDbId = existing.id;
    plan = JSON.parse(existing.plan) as PMPlan;
    runningCost = existing.runningCost ?? 0;

    if (existing.taskGraph) {
      // Normal resume: task graph exists from a previous execution
      const savedGraph = JSON.parse(existing.taskGraph) as TaskGraph;
      const resumeResult = prepareGraphForResume(savedGraph);
      resumedGraph = resumeResult.graph;

      resumeTrigger = {
        type: "pipeline_resumed",
        interruptedTasks: resumeResult.interruptedTasks,
        failedTasks: resumeResult.failedTasks,
      };
    } else {
      // Resume after plan rejection: plan exists but was never executed.
      // Build a fresh graph from the plan — execution starts from scratch.
      appendLog(projectId, `\n📋 Resuming from rejected plan — building task graph\n`);
      resumedGraph = buildTaskGraph(plan);

      // Re-create task records in DB (they may have been left from the rejected attempt)
      try {
        await stores.task.deleteMany({ where: { pipelineRunId: pipelineRunDbId } });
        taskMap = await createTasksFromPlan(stores, projectId, pipelineRunDbId, plan.tasks);
      } catch {
        // Non-fatal
      }
    }

    // Restore completed steps from previous run
    if (existing.completedSteps) {
      const previousSteps = JSON.parse(existing.completedSteps) as StepResult[];
      steps.push(...previousSteps);
    }

    if (projectSettings.personalityEnabled !== false) {
      initializeRelationships(projectId).catch(() => {});
      const allAgentTypes = Object.keys(getAgentRegistry());
      ensurePersonalities(projectId, allAgentTypes).catch(() => {});
    }

    const doneTasks = Object.values(resumedGraph.tasks).filter(t => t.status === "done").length;
    appendLog(projectId, `\n${"=".repeat(80)}\n🔄 PIPELINE RESUMED\n${"=".repeat(80)}\n`);
    appendLog(projectId, `📋 Project: ${project.name}\n`);
    appendLog(projectId, `📂 Path: ${project.path}\n`);
    appendLog(projectId, `💰 Cost so far: $${runningCost.toFixed(3)}\n`);
    appendLog(projectId, `📊 Tasks: ${Object.keys(resumedGraph.tasks).length} total, ${doneTasks} done\n`);
    appendLog(projectId, `⏰ Resumed: ${new Date().toLocaleString()}\n\n`);

    await checkpoint(stores, runId, {
      status: "running",
      taskGraph: JSON.stringify(resumedGraph),
    });
  } else {
    // ----- Fresh run -----
    clearLog(projectId);
    resetAbort(projectId);

    const existing = await stores.pipelineRun.findUnique({ where: { runId } });
    if (existing) {
      pipelineRunDbId = existing.id;
    } else {
      const created = await stores.pipelineRun.create({
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
    appendLog(projectId, `🧠 Orchestration: dynamic (PM decision loop)\n`);
    appendLog(projectId, `💬 Request: ${userMessage.slice(0, 200)}${userMessage.length > 200 ? "..." : ""}\n`);
    appendLog(projectId, `⏰ Started: ${new Date().toLocaleString()}\n\n`);

    const registry = getAgentRegistry();
    for (const required of REQUIRED_AGENTS) {
      if (!registry[required]) {
        const error = `Required agent "${required}" not found. Ensure agents/${required}/AGENT.md exists.`;
        appendLog(projectId, `\n❌ ${error}\n`);
        await checkpoint(stores, runId, { status: "failed", error }, projectId);
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
    const bestModel = await getBestAvailableModel();
    const pmResult = await runAgent({
      agent: AGENT.PM,
      prompt: pmPrompt,
      cwd: project.path,
      projectId,
      settings: projectSettings,
      taskHint: { provider: bestModel.provider, model: bestModel.model },
      pipelineRunId: pipelineRunDbId,
    });

    if (pmResult.cost) {
      runningCost += pmResult.cost;
    }

    if (isAborted(projectId)) {
      appendLog(projectId, `\n🛑 Pipeline stopped by user during planning\n`);
      emit({ type: "agent_done", agent: AGENT.PM, message: "Stopped by user" });
      await checkpoint(stores, runId, { status: "aborted" }, projectId);
      return { response: "Pipeline stopped.", steps, runId };
    }

    const pmParsed = parsePMOutput(pmResult.output);

    if (pmParsed.response) {
      appendLog(projectId, `\n💬 PM responded conversationally (no pipeline needed)\n`);
      emit({ type: "agent_done", agent: AGENT.PM, message: "Conversational response" });
      await checkpoint(stores, runId, { status: "completed" }, projectId);
      return { response: pmParsed.response, steps, runId };
    }

    if (pmParsed.clarification) {
      const formatted = pmParsed.clarification.map((q, i) => `${i + 1}. ${q}`).join("\n");
      appendLog(projectId, `\n💬 Clarification needed before proceeding:\n${formatted}\n`);
      emit({ type: "agent_done", agent: AGENT.PM, message: "Needs clarification" });
      await checkpoint(stores, runId, { status: "completed" }, projectId);
      return {
        response: `I need a few clarifications before creating a plan:\n\n${formatted}`,
        steps,
        runId,
      };
    }

    plan = pmParsed.plan;
    if (!plan) {
      appendLog(projectId, `\n⚠️ Could not parse PM plan from output — raw:\n${pmResult.output.slice(0, 500)}\n`);
      emit({ type: "agent_error", agent: AGENT.PM, message: "Could not parse plan" });
      await checkpoint(stores, runId, { status: "failed", error: "Could not parse PM plan" }, projectId);
      const sanitized = pmResult.output.replace(/\[PM_PLAN\][\s\S]*?\[\/PM_PLAN\]/g, "").trim();
      return { response: sanitized || "Could not generate a plan. Please try rephrasing.", steps, runId };
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
        taskMap = await createTasksFromPlan(stores, projectId, pipelineRunDbId, plan.tasks);
        appendLog(projectId, `📋 Created ${taskMap.size} task record(s)\n`);
      } catch {
        // Non-fatal
      }
    }

    // Checkpoint
    await checkpoint(stores, runId, {
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

        await checkpoint(stores, runId, { status: "failed", error: "Plan rejected by user" }, projectId);

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

      await checkpoint(stores, runId, { status: "running" });
    } catch {
      appendLog(projectId, `\n⚡ Plan auto-confirmed (no response within timeout)\n\n`);
    } finally {
      cleanupPlanFiles(projectId, runId);
    }
  }

  if (!plan) {
    await checkpoint(stores, runId, { status: "failed", error: "No plan available" }, projectId);
    return { response: "No plan available for execution.", steps, runId };
  }

  // ===== EXECUTION: Dynamic orchestration (PM decision loop) =====

  appendLog(projectId, `\n${"=".repeat(80)}\n🧠 DYNAMIC ORCHESTRATION — PM DECISION LOOP\n${"=".repeat(80)}\n\n`);

  const graph = resumedGraph ?? buildTaskGraph(plan);

  // Save initial graph
  await checkpoint(stores, runId, { taskGraph: JSON.stringify(graph) });

  const loopResult = await runPMDecisionLoop({
    projectId,
    conversationId,
    graph,
    settings: projectSettings,
    pipelineRunDbId: pipelineRunDbId!,
    runId,
    project: { path: project.path, name: project.name },
    userMessage,
    plan,
    onProgress: emit,
    ...(resumeTrigger ? { initialTrigger: resumeTrigger } : {}),
  });

  steps.push(...loopResult.steps);
  runningCost += loopResult.cost;
  allDebates.push(...loopResult.debates);

  // 4. Generate summary
  appendLog(projectId, `\n${"=".repeat(80)}\n📝 GENERATING SUMMARY\n${"=".repeat(80)}\n`);
  emit({ type: "summary", title: "Generating summary..." });
  const summary = await generateSummary(userMessage, steps, project.path);

  // 4.5 Generate team standup
  let standupResult: StandupResult | undefined;
  const pipelineWasAborted = steps.some(s => s.output.includes("Aborted"));
  if (!pipelineWasAborted && pipelineRunDbId && plan) {
    try {
      appendLog(projectId, `\n${"=".repeat(80)}\n🗣️  GENERATING TEAM STANDUP\n${"=".repeat(80)}\n`);
      standupResult = await generateStandup({
        pipelineRunId: pipelineRunDbId,
        projectId,
        cwd: project.path,
        userMessage,
        steps,
        plan,
        fixCycleCount: 0,
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

  await checkpoint(stores, runId, {
    status: "completed",
    runningCost,
    completedSteps: JSON.stringify(steps),
  }, projectId);

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

  return { response: summary, steps, plan, runId, standup: standupResult, agentMessages, debates: debateResults };
}
