/**
 * PM decision loop — replaces the sequential pipeline for-loop.
 *
 * At each cycle:
 * 1. Something happens (task done, failed, user message, agent message to PM)
 * 2. PM is called with current state + trigger
 * 3. PM returns structured JSON decisions
 * 4. Engine executes the decisions
 * 5. Repeat
 */

import { prisma } from "./prisma";
import { appendLog as rawAppendLog, isAborted } from "./claude-code";
import { getAgentRegistry } from "./agent-loader";
import { logEvent, getEventHistory, formatEventsForPrompt } from "./event-log";
import { queryMemories, formatMemoriesForPrompt, getMemoryTypesForAgent } from "./memory";
import { ingestDecisionFromEvent, ingestPersonalityFromAgentRun } from "./memory-ingestion";
import { updateRelationships } from "./personality";
import { getMessageInstructions, extractMessages, storeMessages, getInboxMessages, formatInboxForPrompt } from "./agent-messages";
import { evaluateDebateTriggers, runDebateRound, storeDebateRound, ingestDebateMemory, updateDebateRelationships, type DebateRoundResult } from "./debate";
import { buildPMDecisionPrompt } from "./pm-decision-prompt";
import { buildStepPrompt, type StepResult, type PMPlan } from "./prompt-builders";
import { runAgent, getEventType } from "./agent-runner";
import {
  getReadyTasks,
  updateTaskStatus,
  addTasksToGraph,
  removeTasksFromGraph,
  isGraphComplete,
  isGraphStuck,
  reassignTask,
  blockTask,
  unblockTask,
  retryTask,
  nextTaskId,
} from "./task-graph-engine";
import { checkForUserMessages, writePMQuestion, waitForUserResponse, cleanupQuestionFiles } from "./user-message-gate";
import { extractJSON } from "./utils";
import { getCheapestAvailableModel, getAdapter } from "./providers/index";
import { calculateCost } from "./cost-calculator";
import type { ProjectSettings } from "@/types/settings";
import type { PipelineProgressEvent } from "@/types/pipeline";
import type {
  TaskGraph,
  TaskNode,
  PMDecision,
  PMDecisionContext,
  DecisionTrigger,
} from "@/types/task-graph";
import {
  MAX_PARALLEL_TASKS,
  MAX_PM_DECISIONS_PER_RUN,
  EVENT_HISTORY_LIMIT,
  RAG_MEMORY_LIMIT,
  TASK_OUTPUT_SUMMARY_LENGTH,
} from "@/lib/constants";
import { AGENT } from "@/lib/models";
import crypto from "crypto";

function appendLog(projectId: string, text: string) {
  rawAppendLog(projectId, text);
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface DecisionLoopResult {
  steps: StepResult[];
  graph: TaskGraph;
  cost: number;
  debates: DebateRoundResult[];
}

interface RunContext {
  projectId: string;
  conversationId: string;
  settings: ProjectSettings;
  pipelineRunDbId: string;
  runId: string;
  project: { path: string; name: string };
  userMessage: string;
  plan: PMPlan;
}

// ── Main loop ──────────────────────────────────────────────────────────────

export async function runPMDecisionLoop(opts: {
  projectId: string;
  conversationId: string;
  graph: TaskGraph;
  settings: ProjectSettings;
  pipelineRunDbId: string;
  runId: string;
  project: { path: string; name: string };
  userMessage: string;
  plan: PMPlan;
  onProgress: (event: PipelineProgressEvent) => void;
}): Promise<DecisionLoopResult> {
  const {
    projectId,
    settings,
    pipelineRunDbId,
    runId,
    onProgress: emit,
  } = opts;

  let graph = opts.graph;
  let decisionCount = 0;
  let runningCost = 0;
  const steps: StepResult[] = [];
  const allDebates: DebateRoundResult[] = [];
  const agentSessionIds = new Map<string, string>();
  const agentMessagesToPM: PMDecisionContext["agentMessagesToPM"] = [];
  const recentAgentMessages: PMDecisionContext["recentAgentMessages"] = [];
  const accumulatedUserMessages: string[] = [];
  const startTime = Date.now();

  // Track running tasks as promises
  const runningTaskPromises = new Map<
    string,
    Promise<{ taskId: string; result: { success: boolean; output: string; cost?: number } }>
  >();

  // Seed initial trigger
  const readyTasks = getReadyTasks(graph);
  let pendingTrigger: DecisionTrigger | null = readyTasks.length > 0
    ? { type: "initial", readyTasks }
    : null;

  appendLog(projectId, `\n🧠 PM DECISION LOOP STARTED\n`);
  appendLog(projectId, `📊 ${Object.keys(graph.tasks).length} task(s) in graph\n`);
  appendLog(projectId, `🚀 ${readyTasks.length} task(s) ready to execute\n\n`);

  while (decisionCount < MAX_PM_DECISIONS_PER_RUN) {
    // 1. Check abort
    if (isAborted(projectId)) {
      appendLog(projectId, `\n🛑 Pipeline aborted by user during decision loop\n`);
      break;
    }

    // 2. Check for user messages (non-blocking)
    const newUserMessages = checkForUserMessages(projectId, runId);
    if (newUserMessages.length > 0) {
      accumulatedUserMessages.push(...newUserMessages);
      appendLog(projectId, `📨 ${newUserMessages.length} user message(s) received\n`);
      // User message becomes the trigger if nothing else is pending
      if (!pendingTrigger) {
        pendingTrigger = { type: "user_message", message: newUserMessages[newUserMessages.length - 1] };
      }
    }

    // 3. If no trigger and tasks are running, wait for one to complete
    if (!pendingTrigger && runningTaskPromises.size > 0) {
      const completed = await Promise.race(runningTaskPromises.values());
      runningTaskPromises.delete(completed.taskId);
      const taskNode = graph.tasks[completed.taskId];

      if (completed.result.success) {
        graph = updateTaskStatus(graph, completed.taskId, {
          status: "done",
          output: completed.result.output,
          costUsd: completed.result.cost,
        });

        // Process completed task output
        await processTaskOutput(
          completed.taskId,
          completed.result,
          taskNode,
          graph,
          opts,
          steps,
          agentMessagesToPM,
          recentAgentMessages,
          allDebates,
          pipelineRunDbId,
          settings,
        );

        if (completed.result.cost) runningCost += completed.result.cost;

        pendingTrigger = {
          type: "task_completed",
          taskId: completed.taskId,
          output: completed.result.output.slice(0, TASK_OUTPUT_SUMMARY_LENGTH),
        };
      } else {
        const attempts = (taskNode?.attempts ?? 0) + 1;
        graph = updateTaskStatus(graph, completed.taskId, {
          status: "failed",
          error: completed.result.output,
          attempts,
        });

        steps.push({
          agent: taskNode?.agent ?? "unknown",
          role: taskNode?.role,
          title: taskNode?.title ?? completed.taskId,
          status: "failed",
          output: completed.result.output,
        });

        if (completed.result.cost) runningCost += completed.result.cost;

        pendingTrigger = {
          type: "task_failed",
          taskId: completed.taskId,
          error: completed.result.output.slice(0, TASK_OUTPUT_SUMMARY_LENGTH),
          attempts,
        };
      }

      // Update task in DB
      await updateTaskInDb(completed.taskId, graph.tasks[completed.taskId], pipelineRunDbId);
    }

    // 4. If no trigger and nothing running
    if (!pendingTrigger) {
      if (isGraphComplete(graph)) {
        appendLog(projectId, `\n✅ All tasks complete — synthesizing final decision\n`);
        pendingTrigger = { type: "all_idle" };
      } else if (isGraphStuck(graph)) {
        appendLog(projectId, `\n⚠️ Graph is stuck — asking PM for guidance\n`);
        pendingTrigger = { type: "all_idle" };
      } else {
        // Tasks are ready but no trigger — use initial
        const ready = getReadyTasks(graph);
        if (ready.length > 0) {
          pendingTrigger = { type: "initial", readyTasks: ready };
        } else {
          // Nothing to do — shouldn't happen, safety exit
          appendLog(projectId, `\n⚠️ No trigger and no ready tasks — exiting loop\n`);
          break;
        }
      }
    }

    // 5. Build PM decision context
    const ctx: PMDecisionContext = {
      trigger: pendingTrigger!,
      graph,
      runningTasks: Array.from(runningTaskPromises.keys()),
      completedTasks: Object.values(graph.tasks)
        .filter((t) => t.status === "done")
        .map((t) => ({
          id: t.id,
          outputSummary: (t.output ?? "").slice(0, TASK_OUTPUT_SUMMARY_LENGTH),
          costUsd: t.costUsd ?? 0,
        })),
      failedTasks: Object.values(graph.tasks)
        .filter((t) => t.status === "failed")
        .map((t) => ({
          id: t.id,
          error: (t.error ?? t.output ?? "").slice(0, TASK_OUTPUT_SUMMARY_LENGTH),
          attempts: t.attempts,
        })),
      readyTasks: getReadyTasks(graph),
      budget: {
        spent: runningCost,
        limit: settings.budgetLimit ?? 10,
        remaining: (settings.budgetLimit ?? 10) - runningCost,
      },
      availableAgents: getAvailableAgentsList(settings),
      agentMessagesToPM: [...agentMessagesToPM],
      recentAgentMessages: [...recentAgentMessages],
      userMessages: [...accumulatedUserMessages],
      elapsedMs: Date.now() - startTime,
    };

    // 6. Call PM for decision
    appendLog(projectId, `\n${"─".repeat(60)}\n`);
    appendLog(projectId, `🧠 PM DECISION #${decisionCount + 1} (trigger: ${pendingTrigger!.type})\n`);
    appendLog(projectId, `${"─".repeat(60)}\n`);

    const pmPrompt = buildPMDecisionPrompt(ctx);
    const pmModel = await getCheapestAvailableModel();
    const pmAdapter = getAdapter(pmModel.provider);

    const pmResult = await pmAdapter.execute({
      prompt: pmPrompt,
      systemPrompt: "You are the Project Manager (PM). You make routing decisions during pipeline execution. Always output your decision in [PM_DECISION]...[/PM_DECISION] blocks with valid JSON.",
      model: pmModel.model,
      agentLabel: "pm:decision",
    });

    const pmCost = pmResult.tokensUsed
      ? calculateCost(pmModel.model, pmResult.tokensUsed)
      : 0;
    if (pmCost) runningCost += pmCost;

    // 7. Parse PM decision
    const decision = parsePMDecision(pmResult.output);
    if (!decision) {
      appendLog(projectId, `⚠️ Could not parse PM decision — checking if graph is complete\n`);
      if (isGraphComplete(graph) || isGraphStuck(graph)) {
        break;
      }
      // Try to auto-execute ready tasks
      const ready = getReadyTasks(graph);
      if (ready.length > 0) {
        appendLog(projectId, `🔄 Auto-executing ${ready.length} ready task(s)\n`);
        await launchTasks(
          ready.slice(0, MAX_PARALLEL_TASKS),
          graph,
          opts,
          runningTaskPromises,
          agentSessionIds,
          pipelineRunDbId,
        );
        for (const id of ready.slice(0, MAX_PARALLEL_TASKS)) {
          graph = updateTaskStatus(graph, id, { status: "running" });
        }
      }
      pendingTrigger = null;
      decisionCount++;
      continue;
    }

    appendLog(projectId, `💭 Reasoning: ${decision.reasoning}\n`);
    appendLog(projectId, `📋 Actions: ${decision.actions.map((a) => a.type).join(", ")}\n`);

    // 8. Log decision to DB
    await prisma.pMDecisionLog.create({
      data: {
        pipelineRunId: pipelineRunDbId,
        triggerType: pendingTrigger!.type,
        triggerData: JSON.stringify(pendingTrigger),
        decision: JSON.stringify(decision),
        costUsd: pmCost,
      },
    });

    // Clear consumed state
    pendingTrigger = null;
    agentMessagesToPM.length = 0;
    recentAgentMessages.length = 0;
    accumulatedUserMessages.length = 0;

    // 9. Execute decision actions
    let shouldExit = false;
    for (const action of decision.actions) {
      if (shouldExit) break;

      switch (action.type) {
        case "execute": {
          const toExecute = action.taskIds.filter(
            (id) => graph.tasks[id] && (graph.tasks[id].status === "ready" || graph.tasks[id].status === "pending"),
          );
          const capped = toExecute.slice(0, MAX_PARALLEL_TASKS - runningTaskPromises.size);
          if (capped.length > 0) {
            appendLog(projectId, `▶️ Executing: ${capped.join(", ")}\n`);
            await launchTasks(capped, graph, opts, runningTaskPromises, agentSessionIds, pipelineRunDbId);
            for (const id of capped) {
              graph = updateTaskStatus(graph, id, { status: "running" });
            }
          }
          break;
        }

        case "add_tasks": {
          const newIds: string[] = [];
          const newTasks: Omit<TaskNode, "status" | "attempts" | "addedBy">[] = [];
          for (const taskSpec of action.tasks) {
            const id = taskSpec.id || nextTaskId(graph);
            newTasks.push({ ...taskSpec, id });
            newIds.push(id);
          }
          graph = addTasksToGraph(graph, newTasks, `decision-${decisionCount}`);

          // Create DB records for new tasks
          for (const task of newTasks) {
            try {
              await prisma.task.create({
                data: {
                  projectId,
                  pipelineRunId: pipelineRunDbId,
                  title: task.title,
                  description: task.description,
                  acceptanceCriteria: task.acceptanceCriteria ?? [],
                  skills: task.skills ?? [],
                  assignedAgent: task.agent,
                  assignedRole: task.role,
                  provider: task.provider,
                  model: task.model,
                  status: "created",
                  graphId: task.id,
                  dependsOn: task.dependsOn,
                },
              });
            } catch {
              // Non-fatal
            }
          }

          appendLog(projectId, `➕ Added ${newIds.length} task(s): ${newIds.join(", ")}\n`);
          break;
        }

        case "remove_tasks": {
          graph = removeTasksFromGraph(graph, action.taskIds);
          appendLog(projectId, `🗑️ Removed: ${action.taskIds.join(", ")} — ${action.reason}\n`);

          // Update DB
          for (const id of action.taskIds) {
            try {
              await prisma.task.updateMany({
                where: { pipelineRunId: pipelineRunDbId, graphId: id },
                data: { status: "cancelled" },
              });
            } catch {
              // Non-fatal
            }
          }
          break;
        }

        case "reassign": {
          graph = reassignTask(graph, action.taskId, action.agent, action.role);
          appendLog(projectId, `🔀 Reassigned ${action.taskId} → ${action.agent}${action.role ? `:${action.role}` : ""} — ${action.reason}\n`);

          try {
            await prisma.task.updateMany({
              where: { pipelineRunId: pipelineRunDbId, graphId: action.taskId },
              data: { assignedAgent: action.agent, assignedRole: action.role },
            });
          } catch {
            // Non-fatal
          }
          break;
        }

        case "retry": {
          graph = retryTask(graph, action.taskId, action.changes);
          appendLog(projectId, `🔄 Retrying ${action.taskId}${action.changes?.description ? " (with updated instructions)" : ""}\n`);
          break;
        }

        case "ask_user": {
          appendLog(projectId, `❓ PM asking user: ${action.question}\n`);

          // Block specified tasks
          if (action.blockingTaskIds) {
            for (const id of action.blockingTaskIds) {
              graph = blockTask(graph, id, action.question);
            }
          }

          // Write question file and wait for response
          writePMQuestion(projectId, runId, action.question, action.context);
          emit({ type: "agent_message", agent: AGENT.PM, message: `Question: ${action.question}` });

          const answer = await waitForUserResponse(projectId, runId, {
            abortCheck: () => isAborted(projectId),
          });

          cleanupQuestionFiles(projectId, runId);

          if (answer) {
            appendLog(projectId, `✅ User answered: ${answer.slice(0, 200)}\n`);
            accumulatedUserMessages.push(answer);

            // Unblock tasks
            if (action.blockingTaskIds) {
              for (const id of action.blockingTaskIds) {
                graph = unblockTask(graph, id);
              }
            }

            pendingTrigger = { type: "user_message", message: answer };
          } else {
            appendLog(projectId, `⏰ No user response — continuing without answer\n`);
            // Unblock tasks anyway
            if (action.blockingTaskIds) {
              for (const id of action.blockingTaskIds) {
                graph = unblockTask(graph, id);
              }
            }
          }
          break;
        }

        case "answer_agent": {
          appendLog(projectId, `💬 PM answering agent on ${action.taskId}: ${action.answer.slice(0, 200)}\n`);
          // Unblock the task if blocked
          if (graph.tasks[action.taskId]?.status === "blocked") {
            graph = unblockTask(graph, action.taskId);
          }
          // The answer will be injected into the task's prompt on next execution
          // by storing it as a note
          try {
            const dbTask = await prisma.task.findFirst({
              where: { pipelineRunId: pipelineRunDbId, graphId: action.taskId },
            });
            if (dbTask) {
              await prisma.taskNote.create({
                data: {
                  taskId: dbTask.id,
                  author: "pm",
                  content: `PM Answer: ${action.answer}`,
                },
              });
            }
          } catch {
            // Non-fatal
          }
          break;
        }

        case "complete": {
          appendLog(projectId, `\n✅ PM says: COMPLETE — ${action.summary}\n`);
          shouldExit = true;
          break;
        }

        case "skip": {
          for (const id of action.taskIds) {
            graph = updateTaskStatus(graph, id, { status: "skipped" });
          }
          appendLog(projectId, `⏭️ Skipped: ${action.taskIds.join(", ")} — ${action.reason}\n`);

          for (const id of action.taskIds) {
            try {
              await prisma.task.updateMany({
                where: { pipelineRunId: pipelineRunDbId, graphId: id },
                data: { status: "skipped" },
              });
            } catch {
              // Non-fatal
            }
          }
          break;
        }
      }
    }

    if (shouldExit) break;

    // 10. Budget check
    if (settings.budgetLimit && runningCost > settings.budgetLimit) {
      appendLog(projectId, `\n💰 BUDGET EXCEEDED: $${runningCost.toFixed(2)} > $${settings.budgetLimit}\n`);
      steps.push({
        agent: AGENT.PM,
        title: "Budget limit exceeded",
        status: "failed",
        output: `Budget limit of $${settings.budgetLimit} exceeded (current: $${runningCost.toFixed(2)})`,
      });
      break;
    }

    // 11. Checkpoint to DB
    await prisma.pipelineRun.update({
      where: { runId },
      data: {
        taskGraph: JSON.stringify(graph),
        decisionCount: decisionCount + 1,
        runningCost,
        completedSteps: JSON.stringify(steps),
        updatedAt: new Date(),
      },
    });

    decisionCount++;
  }

  // Wait for any still-running tasks to complete
  if (runningTaskPromises.size > 0) {
    appendLog(projectId, `\n⏳ Waiting for ${runningTaskPromises.size} running task(s) to finish...\n`);
    const remaining = await Promise.allSettled(runningTaskPromises.values());
    for (const result of remaining) {
      if (result.status === "fulfilled") {
        const { taskId, result: taskResult } = result.value;
        const taskNode = graph.tasks[taskId];
        graph = updateTaskStatus(graph, taskId, {
          status: taskResult.success ? "done" : "failed",
          output: taskResult.output,
          costUsd: taskResult.cost,
        });
        if (taskResult.cost) runningCost += taskResult.cost;

        steps.push({
          agent: taskNode?.agent ?? "unknown",
          role: taskNode?.role,
          title: taskNode?.title ?? taskId,
          status: taskResult.success ? "done" : "failed",
          output: taskResult.output,
        });
      }
    }
  }

  appendLog(projectId, `\n🧠 PM DECISION LOOP ENDED (${decisionCount} decisions, $${runningCost.toFixed(3)})\n`);

  return { steps, graph, cost: runningCost, debates: allDebates };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parsePMDecision(raw: string): PMDecision | null {
  const blockMatch = raw.match(
    /\[PM_DECISION\]\s*\n?\s*([\s\S]*?)\s*\n?\s*\[\/PM_DECISION\]/,
  );
  if (!blockMatch) {
    // Try extractJSON as fallback
    const json = extractJSON(raw);
    if (json && typeof json === "object" && "actions" in json) {
      return json as PMDecision;
    }
    return null;
  }

  try {
    return JSON.parse(blockMatch[1]) as PMDecision;
  } catch {
    // Try extractJSON on the inner content
    const json = extractJSON(blockMatch[1]);
    if (json && typeof json === "object" && "actions" in json) {
      return json as PMDecision;
    }
    return null;
  }
}

function getAvailableAgentsList(settings: ProjectSettings) {
  const registry = getAgentRegistry();
  return Object.values(registry)
    .filter((a) => settings.agents[a.type]?.enabled !== false)
    .map((a) => {
      const agentRoles = settings.agents[a.type]?.roles;
      const roles = Object.keys(a.roles).filter(
        (r) => agentRoles?.[r]?.enabled !== false,
      );
      return {
        type: a.type,
        name: a.name,
        roles,
        capabilities: a.capabilities ?? [],
      };
    });
}

async function launchTasks(
  taskIds: string[],
  graph: TaskGraph,
  ctx: {
    projectId: string;
    conversationId: string;
    settings: ProjectSettings;
    pipelineRunDbId: string;
    project: { path: string; name: string };
    userMessage: string;
    plan: PMPlan;
  },
  runningPromises: Map<string, Promise<{ taskId: string; result: { success: boolean; output: string; cost?: number } }>>,
  sessionIds: Map<string, string>,
  pipelineRunDbId: string,
) {
  for (const taskId of taskIds) {
    const task = graph.tasks[taskId];
    if (!task) continue;

    const sessionKey = `${task.agent}${task.role ? `:${task.role}` : ""}`;
    if (!sessionIds.has(sessionKey)) {
      sessionIds.set(sessionKey, crypto.randomUUID());
    }

    // Mark task in_progress in DB
    try {
      await prisma.task.updateMany({
        where: { pipelineRunId: pipelineRunDbId, graphId: taskId },
        data: { status: "in_progress", startedAt: new Date(), attempts: { increment: 1 } },
      });
    } catch {
      // Non-fatal
    }

    const promise = executeTaskAsync(taskId, task, graph, ctx, sessionIds.get(sessionKey)!, pipelineRunDbId);
    runningPromises.set(taskId, promise);
  }
}

async function executeTaskAsync(
  taskId: string,
  task: TaskNode,
  graph: TaskGraph,
  ctx: {
    projectId: string;
    conversationId: string;
    settings: ProjectSettings;
    pipelineRunDbId: string;
    project: { path: string; name: string };
    userMessage: string;
    plan: PMPlan;
  },
  sessionId: string,
  pipelineRunDbId: string,
): Promise<{ taskId: string; result: { success: boolean; output: string; cost?: number } }> {
  const { projectId, settings, project, userMessage, plan } = ctx;

  appendLog(projectId, `\n▶️ [${taskId}] ${task.agent}${task.role ? `:${task.role}` : ""}: ${task.title}\n`);

  // Build events context
  const currentEvents = await getEventHistory({ projectId, limit: EVENT_HISTORY_LIMIT });
  const eventsContext = formatEventsForPrompt(currentEvents);

  // RAG memory
  let memoryContext = "";
  if (settings.personalityEnabled !== false) {
    try {
      const memories = await queryMemories({
        projectId,
        query: task.description ?? userMessage,
        agent: task.agent,
        types: getMemoryTypesForAgent(),
        limit: RAG_MEMORY_LIMIT,
      });
      if (memories.length > 0) {
        memoryContext = formatMemoriesForPrompt(memories);
      }
    } catch {
      // Non-fatal
    }
  }

  // Inter-agent messaging inbox
  let inboxContext = "";
  let messageInstructions = "";
  try {
    const inbox = await getInboxMessages({
      pipelineRunId: pipelineRunDbId,
      toAgent: task.agent,
    });
    if (inbox.length > 0) {
      inboxContext = formatInboxForPrompt(inbox, settings.voiceEnabled === true);
    }
    const otherAgents = [...new Set(
      Object.values(ctx.plan.tasks).map((t) => typeof t === "object" && "agent" in t ? (t as { agent: string }).agent : ""),
    )].filter(Boolean);
    messageInstructions = getMessageInstructions(task.agent, otherAgents);
  } catch {
    // Non-fatal
  }

  // Collect output from dependency tasks for context
  const lastOutput = task.dependsOn
    .map((depId) => graph.tasks[depId]?.output)
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, TASK_OUTPUT_SUMMARY_LENGTH * 3);

  // Build the step prompt
  const pmTask = {
    id: parseInt(task.id.replace("t", ""), 10) || 0,
    title: task.title,
    description: task.description,
    agent: task.agent,
    role: task.role ?? "code",
    dependsOn: task.dependsOn.map((d) => parseInt(d.replace("t", ""), 10) || 0),
    acceptanceCriteria: task.acceptanceCriteria,
    skills: task.skills,
    provider: task.provider,
    model: task.model,
  };

  const prompt = buildStepPrompt({
    step: { agent: task.agent, role: task.role },
    task: pmTask,
    userMessage,
    projectPath: project.path,
    eventsContext,
    lastOutput,
    plan,
    memoryContext,
    inboxContext,
    messageInstructions,
  });

  const result = await runAgent({
    agent: task.agent,
    role: task.role,
    prompt,
    cwd: project.path,
    projectId,
    settings,
    taskHint: task.provider || task.model || task.skills
      ? { provider: task.provider, model: task.model, skills: task.skills }
      : undefined,
    pipelineRunId: pipelineRunDbId,
    memoryContext,
    sessionId,
  });

  appendLog(
    projectId,
    `${result.success ? "✅" : "❌"} [${taskId}] ${task.title} — ${result.success ? "done" : "failed"}\n`,
  );

  return { taskId, result };
}

async function processTaskOutput(
  taskId: string,
  result: { success: boolean; output: string; cost?: number },
  taskNode: TaskNode | undefined,
  graph: TaskGraph,
  ctx: RunContext,
  steps: StepResult[],
  agentMessagesToPM: PMDecisionContext["agentMessagesToPM"],
  recentAgentMessages: PMDecisionContext["recentAgentMessages"],
  allDebates: DebateRoundResult[],
  pipelineRunDbId: string,
  settings: ProjectSettings,
) {
  const { projectId } = ctx;
  const agent = taskNode?.agent ?? "unknown";
  const role = taskNode?.role;

  steps.push({
    agent,
    role,
    title: taskNode?.title ?? taskId,
    status: result.success ? "done" : "failed",
    output: result.output,
  });

  // Extract inter-agent messages
  if (result.output) {
    try {
      const { cleanOutput, messages } = extractMessages(result.output);
      if (messages.length > 0) {
        const stored = await storeMessages({
          pipelineRunId: pipelineRunDbId,
          fromAgent: agent,
          fromRole: role,
          phase: 0, // phase is less meaningful in dynamic mode
          messages,
        });

        for (const msg of stored) {
          if (msg.toAgent === "pm") {
            agentMessagesToPM.push({
              from: agent,
              type: msg.messageType,
              content: msg.content,
              taskId,
            });
          } else {
            recentAgentMessages.push({
              from: agent,
              to: msg.toAgent,
              type: msg.messageType,
              content: msg.content,
            });
          }
        }

        // Use cleaned output
        result.output = cleanOutput;
      }
    } catch {
      // Non-fatal
    }
  }

  // Debate evaluation
  const debateEnabled =
    settings.personalityEnabled !== false && settings.debateEnabled !== false;
  if (debateEnabled && result.output) {
    try {
      const conflicts = await evaluateDebateTriggers({
        projectId,
        pipelineRunId: pipelineRunDbId,
        stepIndex: 0,
        step: { agent, role },
        stepOutput: result.output,
        settings,
        runningCost: 0,
        budgetLimit: settings.budgetLimit,
        debatesThisRun: allDebates.length,
      });

      for (const conflict of conflicts) {
        const round = await runDebateRound({
          conflict,
          pipelineRunId: pipelineRunDbId,
          projectId,
          stepIndex: 0,
        });
        await storeDebateRound(round);
        await ingestDebateMemory(projectId, round);
        await updateDebateRelationships(projectId, round);
        allDebates.push(round);
      }
    } catch {
      // Non-fatal
    }
  }

  // Event logging + memory ingestion
  const step = { agent, role };
  const eventType = getEventType(step);
  try {
    const eventRecord = await logEvent({
      projectId,
      taskId: taskId,
      agent,
      role,
      type: eventType,
      data: { summary: result.output.slice(0, 2000), success: result.success },
    });

    if (settings.personalityEnabled !== false) {
      ingestDecisionFromEvent(
        projectId,
        eventRecord.id,
        eventType,
        agent,
        role,
        { summary: result.output.slice(0, 2000), success: result.success },
      ).catch(() => {});
      ingestPersonalityFromAgentRun(
        projectId,
        eventRecord.id,
        agent,
        role,
        result.output,
      ).catch(() => {});
      updateRelationships(projectId, step, result, [], 0).catch(() => {});
    }
  } catch {
    // Non-fatal
  }
}

async function updateTaskInDb(
  graphId: string,
  task: TaskNode | undefined,
  pipelineRunDbId: string,
) {
  if (!task) return;
  try {
    await prisma.task.updateMany({
      where: { pipelineRunId: pipelineRunDbId, graphId },
      data: {
        status: task.status === "done" ? "done" : "failed",
        output: task.output?.slice(0, 50000),
        outputSummary: task.output?.slice(0, 500),
        costUsd: task.costUsd ?? 0,
        completedAt: new Date(),
      },
    });
  } catch {
    // Non-fatal
  }
}
