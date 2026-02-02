/**
 * Orchestrator — the central router.
 * All agents run through Claude Code CLI (`claude -p`) or Gemini API.
 * PM is the brain — decides plan and team composition.
 *
 * Flow: User → Orchestrator → PM (plan) → [confirm] → execute pipeline → response
 */

import { prisma } from "./prisma";
import { runClaudeCode, clearLog, isAborted, resetAbort, getLogFile } from "./claude-code";
import { runLLM } from "./llm";
import { getAgentRegistry, getSystemPrompt, getProviderConfig } from "./agent-loader";
import { logEvent, getEventHistory, formatEventsForPrompt } from "./event-log";
import { getSkillsForAgent, swapProjectSkills } from "./skills";
import { calculateCost, formatCost } from "./cost-calculator";
import { resolveProviderId } from "./providers";
import { parseSettings, type ProjectSettings } from "@/types/settings";
import { writePlanFile, waitForConfirmation, cleanupPlanFiles } from "./plan-gate";
import fs from "fs";

// Helper for logging to the live UI log file
function appendLog(text: string) {
  try { fs.appendFileSync(getLogFile(), text); } catch {}
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

// ----- Main Entry -----

export async function orchestrate(opts: {
  projectId: string;
  conversationId: string;
  userMessage: string;
  runId?: string;
  onProgress?: (event: ProgressEvent) => void;
}): Promise<OrchestratorResult> {
  const { projectId, conversationId, userMessage, onProgress } = opts;
  const runId = opts.runId ?? `run-${Date.now()}`;
  const emit = onProgress ?? (() => {});
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const projectSettings = parseSettings(project.settings);
  const steps: StepResult[] = [];

  let runningCost = 0;

  clearLog();
  resetAbort();

  appendLog(`\n${"=".repeat(80)}\n🚀 LILIT PIPELINE STARTED\n${"=".repeat(80)}\n`);
  appendLog(`📋 Project: ${project.name}\n`);
  appendLog(`📂 Path: ${project.path}\n`);
  appendLog(`🏗️  Stack: ${projectSettings.stack || "auto-detect"}\n`);
  appendLog(`💰 Budget Limit: ${projectSettings.budgetLimit ? `$${projectSettings.budgetLimit}` : "none"}\n`);
  appendLog(`💬 Request: ${userMessage.slice(0, 200)}${userMessage.length > 200 ? "..." : ""}\n`);
  appendLog(`⏰ Started: ${new Date().toLocaleString()}\n\n`);

  // 1. Get event history for context
  appendLog(`📚 Loading project history...\n`);
  const history = await getEventHistory({ projectId, limit: 50 });
  const historyContext = formatEventsForPrompt(history);
  appendLog(`✅ Loaded ${history.length} previous events\n\n`);

  // 2. Ask PM to create a plan
  emit({ type: "agent_start", agent: "pm", title: "Creating execution plan..." });
  const pmPrompt = buildPMPrompt(userMessage, project.path, project.name, historyContext);
  const pmResult = await runAgent({
    agent: "pm",
    prompt: pmPrompt,
    cwd: project.path,
    projectId,
    settings: projectSettings,
  });

  if (pmResult.cost) {
    runningCost += pmResult.cost;
  }

  const plan = parsePMPlan(pmResult.output);
  if (!plan) {
    appendLog(`\n❌ ERROR: Could not parse PM plan!\n`);
    appendLog(`Raw PM output:\n${pmResult.output.slice(0, 1000)}\n\n`);
    emit({ type: "agent_error", agent: "pm", message: "Could not parse plan" });
    return { response: `PM response (could not parse plan):\n\n${pmResult.output}`, steps };
  }

  appendLog(`\n${"=".repeat(80)}\n📋 EXECUTION PLAN CREATED\n${"=".repeat(80)}\n`);
  appendLog(`📊 Analysis: ${plan.analysis}\n\n`);
  appendLog(`📝 Tasks (${plan.tasks.length}):\n`);
  plan.tasks.forEach((t, idx) => {
    appendLog(`  ${idx + 1}. [${t.agent}:${t.role}] ${t.title}\n`);
    appendLog(`     ${t.description.slice(0, 100)}${t.description.length > 100 ? "..." : ""}\n`);
  });
  appendLog(`\n🔄 Pipeline: ${plan.pipeline.join(" → ")}\n\n`);

  await logEvent({
    projectId,
    agent: "pm",
    type: "plan_created",
    data: { analysis: plan.analysis, pipeline: plan.pipeline, taskCount: plan.tasks.length },
  });

  steps.push({ agent: "pm", title: "Execution Plan", status: "done", output: plan.analysis });
  emit({ type: "plan_ready", agent: "pm", title: "Plan ready", message: plan.analysis });

  // 2.5. Plan confirmation gate
  appendLog(`\n⏳ AWAITING PLAN CONFIRMATION...\n`);
  emit({ type: "plan_awaiting_confirmation", title: "Waiting for approval..." });

  await logEvent({
    projectId,
    agent: "pm",
    type: "plan_awaiting_confirmation",
    data: { runId, plan },
  });

  writePlanFile(runId, plan);

  try {
    const confirmation = await waitForConfirmation(runId, {
      timeoutMs: 600_000, // 10 min
      pollIntervalMs: 1000,
      abortCheck: isAborted,
    });

    if (confirmation.action === "reject") {
      appendLog(`\n🚫 PLAN REJECTED by user\n`);
      if (confirmation.notes) appendLog(`📝 Notes: ${confirmation.notes}\n`);
      emit({ type: "plan_rejected", title: "Plan rejected" });

      await logEvent({
        projectId,
        agent: "pm",
        type: "plan_rejected",
        data: { notes: confirmation.notes },
      });

      return {
        response: `Plan rejected.${confirmation.notes ? ` Notes: ${confirmation.notes}` : ""}`,
        steps,
        plan,
      };
    }

    appendLog(`\n✅ PLAN CONFIRMED — proceeding with execution\n\n`);
    emit({ type: "plan_confirmed", title: "Plan approved" });

    await logEvent({
      projectId,
      agent: "pm",
      type: "plan_confirmed",
      data: {},
    });
  } catch {
    // Timeout or abort — treat as auto-confirm for backward compatibility
    appendLog(`\n⚡ Plan auto-confirmed (no response within timeout)\n\n`);
  } finally {
    cleanupPlanFiles(runId);
  }

  // 3. Execute pipeline
  const pipeline = parsePipeline(plan.pipeline);
  let lastOutput = "";
  let fixCycle = 0;

  appendLog(`\n${"=".repeat(80)}\n🔧 EXECUTING PIPELINE (${pipeline.length} steps)\n${"=".repeat(80)}\n\n`);

  for (let i = 0; i < pipeline.length; i++) {
    if (isAborted()) {
      appendLog(`\n${"=".repeat(80)}\n🛑 PIPELINE ABORTED BY USER\n${"=".repeat(80)}\n`);
      appendLog(`⏰ Aborted at: ${new Date().toLocaleString()}\n`);
      appendLog(`📊 Completed ${i}/${pipeline.length} steps before abort\n\n`);
      steps.push({
        agent: "pm",
        title: "Pipeline aborted",
        status: "failed",
        output: `Aborted by user at step ${i + 1}/${pipeline.length}`
      });
      emit({ type: "agent_error", agent: "pm", message: "Pipeline aborted by user" });
      break;
    }
    const step = pipeline[i];
    const stepLabel = step.role ? `${step.agent}:${step.role}` : step.agent;
    const task = plan.tasks.find((t) => t.agent === step.agent && (!step.role || t.role === step.role));

    appendLog(`\n${"─".repeat(80)}\n`);
    appendLog(`📍 STEP ${i + 1}/${pipeline.length}: ${stepLabel}\n`);
    if (task) {
      appendLog(`📌 Task: ${task.title}\n`);
      appendLog(`📝 Description: ${task.description.slice(0, 150)}${task.description.length > 150 ? "..." : ""}\n`);
    }
    appendLog(`${"─".repeat(80)}\n`);

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

    const prompt = buildStepPrompt({
      step,
      task,
      userMessage,
      projectPath: project.path,
      eventsContext,
      lastOutput,
      plan,
    });

    const result = await runAgent({
      agent: step.agent,
      role: step.role,
      prompt,
      cwd: project.path,
      projectId,
      settings: projectSettings,
      taskHint: task ? { provider: task.provider, model: task.model } : undefined,
    });

    // Track cost and check budget
    if (result.cost) {
      runningCost += result.cost;

      if (projectSettings.budgetLimit && runningCost > projectSettings.budgetLimit) {
        appendLog(`\n💰 BUDGET LIMIT EXCEEDED: $${runningCost.toFixed(2)} > $${projectSettings.budgetLimit}\n`);
        steps.push({
          agent: "pm",
          title: "Budget limit exceeded",
          status: "failed",
          output: `Budget limit of $${projectSettings.budgetLimit} exceeded (current: $${runningCost.toFixed(2)})`
        });
        break;
      }
    }

    // Check abort after agent runs
    if (isAborted()) {
      appendLog(`\n🛑 Abort detected after agent execution\n`);
      steps.push({
        agent: "pm",
        title: "Pipeline aborted",
        status: "failed",
        output: `Aborted during ${stepLabel} execution`
      });
      break;
    }

    const eventType = getEventType(step);
    await logEvent({
      projectId,
      taskId: task ? String(task.id) : undefined,
      agent: step.agent,
      role: step.role,
      type: eventType,
      data: { summary: result.output.slice(0, 2000), success: result.success },
    });

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
      appendLog(`\n⚠️  FAILURE DETECTED in ${stepLabel}\n`);
      appendLog(`📊 Fix cycle: ${fixCycle + 1}/${MAX_FIX_CYCLES}\n`);

      if (fixCycle >= MAX_FIX_CYCLES) {
        appendLog(`\n🚫 Maximum fix cycles (${MAX_FIX_CYCLES}) reached. Stopping pipeline.\n`);
        steps.push({
          agent: "pm",
          title: "Max fix cycles reached",
          status: "failed",
          output: `Reached ${MAX_FIX_CYCLES} fix attempts. Stopping.`,
        });
        break;
      }

      appendLog(`🔄 Asking PM to re-evaluate and create fix plan...\n`);
      const reEvalPrompt = buildReEvalPrompt(step, result.output, eventsContext, userMessage);
      const reEvalResult = await runAgent({
        agent: "pm",
        prompt: reEvalPrompt,
        cwd: project.path,
        projectId,
        settings: projectSettings,
      });

      if (reEvalResult.cost) {
        runningCost += reEvalResult.cost;
      }

      const fixPlan = parsePMPlan(reEvalResult.output);

      if (fixPlan) {
        appendLog(`✅ Fix plan created: ${fixPlan.pipeline.join(" → ")}\n`);
        appendLog(`📋 Injecting ${fixPlan.pipeline.length} fix steps into pipeline\n\n`);

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
        appendLog(`❌ Could not parse fix plan from PM. Continuing...\n\n`);
      }
    }
  }

  // 4. Generate summary
  appendLog(`\n${"=".repeat(80)}\n📝 GENERATING SUMMARY\n${"=".repeat(80)}\n`);
  emit({ type: "summary", title: "Generating summary..." });
  const summary = await generateSummary(userMessage, steps, project.path);

  appendLog(`\n${"=".repeat(80)}\n✨ PIPELINE COMPLETE\n${"=".repeat(80)}\n`);
  appendLog(`⏰ Finished: ${new Date().toLocaleString()}\n`);
  appendLog(`📊 Total steps: ${steps.length}\n`);
  appendLog(`✅ Successful: ${steps.filter(s => s.status === "done").length}\n`);
  appendLog(`❌ Failed: ${steps.filter(s => s.status === "failed").length}\n`);
  appendLog(`💰 Total cost: ${formatCost(runningCost)}\n\n`);

  emit({ type: "done", message: "Pipeline complete" });
  return { response: summary, steps, plan };
}

// ----- Agent Runner -----

async function runAgent(opts: {
  agent: string;
  role?: string;
  prompt: string;
  cwd: string;
  projectId: string;
  settings?: ProjectSettings;
  taskHint?: { provider?: string; model?: string };
}): Promise<{ success: boolean; output: string; cost?: number }> {
  const systemPrompt = getSystemPrompt(opts.agent, opts.role);

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

  const agentLabel = opts.role ? `${opts.agent}:${opts.role}` : opts.agent;

  appendLog(`\n🔧 Provider: ${provider} | Model: ${model}\n`);
  appendLog(`📏 Prompt length: ${opts.prompt.length} chars\n`);

  let success: boolean;
  let output: string;
  let durationMs: number;
  let tokensUsed: { inputTokens: number; outputTokens: number } | undefined;
  let costUsd: number | undefined;

  if (provider === "gemini") {
    appendLog(`🌐 Using Gemini API (no tool access)\n\n`);
    const result = await runLLM({
      prompt: opts.prompt,
      systemPrompt,
      model,
      agentLabel,
    });
    success = result.success;
    output = result.text;
    durationMs = result.durationMs;
    tokensUsed = result.tokensUsed;

    if (tokensUsed) {
      costUsd = calculateCost(model, tokensUsed);
      appendLog(`💰 Cost: ${formatCost(costUsd)} (${tokensUsed.inputTokens}in/${tokensUsed.outputTokens}out)\n`);
    }
  } else {
    const stack = opts.settings?.stack || "nextjs";
    const skills = getSkillsForAgent(opts.agent, opts.role, stack);
    appendLog(`🧰 Loading skills: ${skills.join(", ") || "none"}\n`);
    await swapProjectSkills(opts.cwd, skills);
    appendLog(`🚀 Using Claude Code CLI (file access + tools)\n\n`);

    const result = await runClaudeCode({
      prompt: opts.prompt,
      cwd: opts.cwd,
      model,
      systemPrompt,
      agentLabel,
    });
    success = result.success;
    output = result.output;
    durationMs = result.durationMs;
    tokensUsed = result.tokensUsed;

    if (tokensUsed) {
      costUsd = calculateCost(model, tokensUsed);
      appendLog(`💰 Cost: ${formatCost(costUsd)} (${tokensUsed.inputTokens}in/${tokensUsed.outputTokens}out)\n`);
    }
  }

  await prisma.agentRun.create({
    data: {
      projectId: opts.projectId,
      agent: opts.agent,
      role: opts.role,
      model,
      input: opts.prompt.slice(0, 10000),
      output: output.slice(0, 50000),
      status: success ? "completed" : "failed",
      durationMs,
      tokensUsed: tokensUsed ? tokensUsed.inputTokens + tokensUsed.outputTokens : null,
      costUsd,
    },
  });

  return { success, output, cost: costUsd };
}

// ----- Prompt Builders -----

function buildPMPrompt(
  userMessage: string,
  projectPath: string,
  projectName: string,
  historyContext: string
): string {
  // Inject available agents list
  const registry = getAgentRegistry();
  const agentsList = Object.values(registry)
    .map((a) => {
      const roles = Object.keys(a.roles);
      return `- ${a.name} (${a.type}): ${a.description}${roles.length > 0 ? ` [roles: ${roles.join(", ")}]` : ""}`;
    })
    .join("\n");

  return `## Project
Name: ${projectName}
Path: ${projectPath}

## Available Agents
${agentsList}

## Event History
${historyContext}

## User Request
${userMessage}

Create an execution plan. Output your response with a JSON block as specified in your instructions.`;
}

function buildStepPrompt(opts: {
  step: PipelineStep;
  task?: PMPlanTask;
  userMessage: string;
  projectPath: string;
  eventsContext: string;
  lastOutput: string;
  plan: PMPlan;
}): string {
  const { step, task, userMessage, projectPath, eventsContext, lastOutput, plan } = opts;

  let prompt = `## Project: ${projectPath}\n\n`;
  prompt += `## Event History\n${eventsContext}\n\n`;
  prompt += `## Original User Request\n${userMessage}\n\n`;

  if (step.agent === "architect") {
    prompt += `## Your Task\nDefine the architecture and tech stack for this project.\n`;
    prompt += `Output your architecture spec as a JSON block.\n`;
  } else if (task) {
    prompt += `## Your Task\n**${task.title}**\n${task.description}\n\n`;
    prompt += `## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}\n\n`;
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

Re-evaluate and create a fix plan. Output JSON with "action": "fix" and a new pipeline.`;
}

// ----- Summary Generator -----

async function generateSummary(
  userMessage: string,
  steps: StepResult[],
  _projectPath: string,
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

  const result = await runLLM({
    prompt,
    systemPrompt: "You are a technical writer. Summarize development work clearly and concisely. Output ONLY the summary text, no code changes.",
    model: "gemini-2.5-flash",
    agentLabel: "summary",
  });

  return result.text || "Pipeline completed. Check steps for details.";
}

// ----- Parsers & Helpers -----

function parsePMPlan(raw: string): PMPlan | null {
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    const braceMatch = raw.match(/\{[\s\S]*"pipeline"[\s\S]*\}/);
    if (!braceMatch) return null;
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed.pipeline && Array.isArray(parsed.pipeline)) return parsed as PMPlan;
    } catch { /* fall through */ }
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed.pipeline && Array.isArray(parsed.pipeline)) {
      return parsed as PMPlan;
    }
    return null;
  } catch {
    return null;
  }
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
