/**
 * PM decision prompt builder — builds the prompt the PM receives at each
 * decision point in the dynamic orchestration loop.
 *
 * Distinct from the initial planning prompt (buildPMPrompt in prompt-builders.ts).
 */

import { getCodename } from "./personality";
import { getGraphSummary } from "./task-graph-engine";
import type { PMDecisionContext } from "@/types/task-graph";

/**
 * Build the PM decision prompt from the current context.
 *
 * The PM receives:
 * 1. What triggered this decision point
 * 2. The current task graph state
 * 3. Agent messages sent to PM
 * 4. Inter-agent messages (for awareness)
 * 5. User messages sent during execution
 * 6. Budget status
 * 7. Available agents
 * 8. Instructions for output format
 */
export function buildPMDecisionPrompt(ctx: PMDecisionContext): string {
  const sections: string[] = [];

  // 1. Trigger
  sections.push(`## Trigger\n\n${formatTrigger(ctx.trigger)}`);

  // 2. Task graph state
  sections.push(`## Task Graph\n\n${getGraphSummary(ctx.graph)}`);

  // 3. Running tasks
  if (ctx.runningTasks.length > 0) {
    sections.push(
      `## Currently Running\n\n${ctx.runningTasks.map((id) => `- ${id}: ${ctx.graph.tasks[id]?.title ?? "unknown"}`).join("\n")}`,
    );
  }

  // 4. Completed tasks (IDs only — use MCP tools to inspect details)
  if (ctx.completedTasks.length > 0) {
    const formatted = ctx.completedTasks
      .map((t) => `- ${t.id} ($${t.costUsd.toFixed(3)})`)
      .join("\n");
    sections.push(`## Completed Tasks\n\n${formatted}`);
  }

  // 5. Failed tasks (IDs only — use MCP tools to inspect details)
  if (ctx.failedTasks.length > 0) {
    const formatted = ctx.failedTasks
      .map((t) => `- ${t.id} (${t.attempts} attempt(s))`)
      .join("\n");
    sections.push(`## Failed Tasks\n\n${formatted}`);
  }

  // 6. Ready tasks
  if (ctx.readyTasks.length > 0) {
    const formatted = ctx.readyTasks
      .map((id) => {
        const task = ctx.graph.tasks[id];
        return task
          ? `- ${id}: ${task.agent}${task.role ? `:${task.role}` : ""} — ${task.title}`
          : `- ${id}`;
      })
      .join("\n");
    sections.push(`## Ready Tasks (can be executed now)\n\n${formatted}`);
  }

  // 7. Agent messages to PM
  if (ctx.agentMessagesToPM.length > 0) {
    const formatted = ctx.agentMessagesToPM
      .map((m) => {
        const codename = getCodename(m.from);
        const sender = codename !== m.from ? `${codename} (${m.from})` : m.from;
        return `- [${m.type}] from ${sender} (task ${m.taskId}): ${m.content}`;
      })
      .join("\n");
    sections.push(`## Messages From Your Team\n\nThese messages were sent to you by agents during execution:\n\n${formatted}`);
  }

  // 8. Inter-team communication
  if (ctx.recentAgentMessages.length > 0) {
    const formatted = ctx.recentAgentMessages
      .map((m) => `- ${m.from} → ${m.to}: [${m.type}] ${m.content}`)
      .join("\n");
    sections.push(`## Inter-Team Communication\n\nRecent messages between other agents (for your awareness):\n\n${formatted}`);
  }

  // 9. User messages
  if (ctx.userMessages.length > 0) {
    const formatted = ctx.userMessages
      .map((m) => `- ${m}`)
      .join("\n");
    sections.push(`## User Messages\n\nThe user sent these messages during pipeline execution:\n\n${formatted}`);
  }

  // 10. Budget
  sections.push(
    `## Budget\n\n- Spent: $${ctx.budget.spent.toFixed(3)}\n- Limit: $${ctx.budget.limit.toFixed(2)}\n- Remaining: $${ctx.budget.remaining.toFixed(3)}`,
  );

  // 11. Available agents
  if (ctx.availableAgents.length > 0) {
    const formatted = ctx.availableAgents
      .map(
        (a) =>
          `- ${a.name} (${a.type})${a.roles.length > 0 ? ` [roles: ${a.roles.join(", ")}]` : ""}`,
      )
      .join("\n");
    sections.push(`## Available Agents\n\n${formatted}`);
  }

  // 12. Elapsed time
  const elapsedSec = Math.round(ctx.elapsedMs / 1000);
  sections.push(`## Elapsed Time\n\n${elapsedSec}s`);

  // 13. Instructions
  sections.push(`## Instructions

Decide what to do next. Consider:
- Which ready tasks should execute now? (up to 3 in parallel)
- Should any failed tasks be retried with changes?
- Do any agent messages require action (answer, escalate, add tasks)?
- Should new tasks be added to address issues?
- Is the graph complete and ready for final summary?
- Is the user asking something that requires plan changes?

ALWAYS read and consider agent messages. If a developer flags an issue, decide whether to add a fix task, reassign, or adjust the plan. If QA asks a question, either answer it yourself (answer_agent) or escalate to the user (ask_user). If an agent sends a suggestion, decide if the plan should change.

Output your decision as:

[PM_DECISION]
{
  "reasoning": "Brief explanation of your decision",
  "actions": [
    { "type": "execute", "taskIds": ["t1", "t2"] }
  ]
}
[/PM_DECISION]

Available action types:
- **execute**: Start tasks: \`{ "type": "execute", "taskIds": ["t1"] }\`
- **add_tasks**: Add new tasks: \`{ "type": "add_tasks", "tasks": [{ "id": "t6", "title": "...", "description": "...", "agent": "developer", "role": "fix", "dependsOn": ["t2"], "acceptanceCriteria": ["..."] }] }\`
- **remove_tasks**: Cancel tasks: \`{ "type": "remove_tasks", "taskIds": ["t5"], "reason": "..." }\`
- **reassign**: Change agent: \`{ "type": "reassign", "taskId": "t3", "agent": "developer", "role": "code", "reason": "..." }\`
- **retry**: Retry failed task: \`{ "type": "retry", "taskId": "t2", "changes": { "description": "updated instructions..." } }\`
- **ask_user**: Escalate to user: \`{ "type": "ask_user", "question": "...", "context": "...", "blockingTaskIds": ["t3"] }\`
- **answer_agent**: Answer agent question: \`{ "type": "answer_agent", "taskId": "t2", "answer": "..." }\`
- **complete**: Pipeline done: \`{ "type": "complete", "summary": "..." }\`
- **skip**: Skip tasks: \`{ "type": "skip", "taskIds": ["t4"], "reason": "..." }\``);

  return sections.join("\n\n");
}

// ── Trigger formatting ────────────────────────────────────────────────────

function formatTrigger(trigger: PMDecisionContext["trigger"]): string {
  switch (trigger.type) {
    case "initial":
      return `Pipeline started. ${trigger.readyTasks.length} task(s) are ready to execute: ${trigger.readyTasks.join(", ")}`;
    case "task_completed":
      return `Task ${trigger.taskId} completed successfully.\n\nOutput summary:\n${trigger.output.slice(0, 500)}`;
    case "task_failed":
      return `Task ${trigger.taskId} failed (attempt ${trigger.attempts}).\n\nError:\n${trigger.error.slice(0, 500)}`;
    case "user_message":
      return `The user sent a message during execution:\n\n"${trigger.message}"`;
    case "agent_question": {
      const codename = getCodename(trigger.agent);
      const name = codename !== trigger.agent ? `${codename} (${trigger.agent})` : trigger.agent;
      return `Agent ${name} (task ${trigger.taskId}) asked a question:\n\n"${trigger.question}"`;
    }
    case "agent_message_to_pm": {
      const codename = getCodename(trigger.agent);
      const name = codename !== trigger.agent ? `${codename} (${trigger.agent})` : trigger.agent;
      return `Agent ${name} (task ${trigger.taskId}) sent you a [${trigger.messageType}] message:\n\n"${trigger.content}"`;
    }
    case "all_idle":
      return "All tasks are either completed, failed, blocked, or cancelled. No tasks are running or ready. Decide whether to add new tasks, retry failed ones, or complete the pipeline.";
    case "budget_warning":
      return `Budget warning: $${trigger.spent.toFixed(2)} spent, $${trigger.remaining.toFixed(2)} remaining. Consider completing soon or reducing scope.`;
    case "pipeline_resumed": {
      const parts = ["The pipeline was previously aborted and is now resuming."];
      if (trigger.interruptedTasks.length > 0) {
        parts.push(`\nInterrupted tasks (were running at abort time, now ready): ${trigger.interruptedTasks.join(", ")}`);
      }
      if (trigger.failedTasks.length > 0) {
        parts.push(`\nFailed tasks (need your decision — retry, skip, or replace): ${trigger.failedTasks.join(", ")}`);
      }
      parts.push("\nReview the task graph state below and decide how to proceed. You can execute ready tasks, retry or skip failed ones, add new tasks, or adjust the plan as needed.");
      return parts.join("");
    }
  }
}
