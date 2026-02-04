/**
 * Prompt builders — extracted from orchestrator.ts.
 *
 * Builds prompts for PM planning, step execution, re-evaluation, and summary.
 */

import { prisma } from "./prisma";
import { getAgent, getAgentRegistry } from "./agent-loader";
import { formatSkillsForPM } from "./skills";
import { getPersonality } from "./personality";
import type { ProjectSettings } from "@/types/settings";
import {
  CONVERSATION_HISTORY_LIMIT,
  ASSISTANT_MESSAGE_PREVIEW_LENGTH,
  CODE_CHANGES_PREVIEW_LENGTH,
  ISSUES_PREVIEW_LENGTH,
} from "@/lib/constants";
import { extractJSON } from "@/lib/utils";

// ----- Types -----

export interface PMPlanTask {
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

export interface PMPlan {
  analysis: string;
  tasks: PMPlanTask[];
  pipeline: string[];
}

export interface StepResult {
  agent: string;
  role?: string;
  title: string;
  status: "done" | "failed";
  output: string;
}

export interface PipelineStep {
  agent: string;
  role?: string;
}

// ----- Conversation context -----

export async function getConversationContext(
  conversationId: string,
): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_HISTORY_LIMIT,
    select: { role: true, content: true },
  });

  if (messages.length === 0) return "No previous messages.";

  return messages
    .reverse()
    .map((m) => {
      if (m.role === "user") return `[User] ${m.content}`;
      const text =
        m.content.length > ASSISTANT_MESSAGE_PREVIEW_LENGTH
          ? m.content.slice(0, ASSISTANT_MESSAGE_PREVIEW_LENGTH) + "..."
          : m.content;
      return `[Assistant] ${text}`;
    })
    .join("\n\n");
}

// ----- PM prompt -----

export async function buildPMPrompt(
  userMessage: string,
  projectPath: string,
  projectName: string,
  historyContext: string,
  conversationContext: string,
  settings?: ProjectSettings,
  projectId?: string,
): Promise<string> {
  const registry = getAgentRegistry();
  const agentsList = Object.values(registry)
    .filter((a) => settings?.agents[a.type]?.enabled !== false)
    .map((a) => {
      const agentRoles = settings?.agents[a.type]?.roles;
      const roles = Object.keys(a.roles).filter(
        (r) => agentRoles?.[r]?.enabled !== false,
      );
      return `- ${a.name} (${a.type}): ${a.description}${roles.length > 0 ? ` [roles: ${roles.join(", ")}]` : ""}`;
    })
    .join("\n");

  const skillsList = formatSkillsForPM();

  // Pipeline Memory
  let pipelineMemorySection = "";
  if (projectId) {
    try {
      const recentInsights = await prisma.standupMessage.findMany({
        where: {
          pipelineRun: { projectId },
          insightType: { not: "none" },
          actionable: true,
        },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: {
          fromAgent: true,
          toAgent: true,
          insightType: true,
          message: true,
          createdAt: true,
        },
      });

      if (recentInsights.length > 0) {
        const agentNames = Object.fromEntries(
          Object.values(registry).map((a) => {
            const p = getPersonality(a.type);
            return [a.type, p?.codename ?? a.name];
          }),
        );
        const formatted = recentInsights
          .map((ins) => {
            const from = agentNames[ins.fromAgent] ?? ins.fromAgent;
            const to = agentNames[ins.toAgent] ?? ins.toAgent;
            const date = ins.createdAt.toISOString().split("T")[0];
            return `- [${ins.insightType}] ${from} → ${to} (${date}): ${ins.message}`;
          })
          .join("\n");

        pipelineMemorySection = `## Pipeline Memory (Past Standup Insights)

Recent observations from your team across previous pipeline runs. Consider these when planning — if a recurring theme has been flagged multiple times, prioritize addressing it.

${formatted}
`;
      }
    } catch {
      // Pipeline memory is non-fatal
    }
  }

  return `## Project
Name: ${projectName}
Path: ${projectPath}
Stack: ${settings?.stack || "not yet determined"}

## Available Agents
${agentsList}

## Available Skills
${skillsList}

## Conversation History
${conversationContext}

## Event History
${historyContext}

${pipelineMemorySection}## User Request
${userMessage}

Respond following the Markdown format from your instructions — either a plan, clarification questions, or a conversational response.`;
}

// ----- Step prompt -----

export function buildStepPrompt(opts: {
  step: PipelineStep;
  task?: PMPlanTask;
  userMessage: string;
  projectPath: string;
  lastOutput?: string;
  plan: PMPlan;
  messageInstructions?: string;
  /** Graph IDs of dependency tasks — agent can fetch their output via tools. */
  dependencyTaskIds?: string[];
}): string {
  const {
    step,
    task,
    userMessage,
    projectPath,
    lastOutput,
    plan,
    messageInstructions,
    dependencyTaskIds,
  } = opts;

  let prompt = `## Project: ${projectPath}\n\n`;

  prompt += `## Available Tools\n`;
  prompt += `You have access to project data tools. Use them to pull context on demand — do NOT assume context, fetch what you need:\n`;
  prompt += `- **search_project_history**: Search past messages, events, and memories\n`;
  prompt += `- **list_tasks** / **get_task**: View tasks and their details (accepts graph IDs like "t1", "t2")\n`;
  prompt += `- **update_task_status**: Update task status and add notes\n`;
  prompt += `- **get_messages**: Read conversation history (you choose how many)\n`;
  prompt += `- **get_step_output**: Read full output from any past task (accepts graph IDs like "t1", "t2")\n`;
  prompt += `- **get_inbox**: Read messages from other agents (questions, flags, suggestions) — check at task start\n`;
  prompt += `- **get_pipeline_runs**: View past pipeline execution history\n`;
  prompt += `- **get_project_info**: Get project name, path, and current tech stack\n`;
  prompt += `- **update_project_stack**: Update the project's tech stack identifier\n\n`;

  prompt += `## Original User Request\n${userMessage}\n\n`;

  const agentDef = getAgent(step.agent);
  const roleDef = step.role ? agentDef?.roles[step.role] : undefined;

  if (agentDef?.taskPreamble && !task) {
    prompt += `## Your Task\n${agentDef.taskPreamble}\n`;
  } else if (task) {
    prompt += `## Your Task\n**${task.title}**\n${task.description}\n\n`;
    prompt += `## Acceptance Criteria\n${(task.acceptanceCriteria ?? []).map((c) => `- ${c}`).join("\n")}\n\n`;
  }

  if (step.role === "review") {
    if (lastOutput) {
      prompt += `## Code Changes to Review (from Developer)\n${lastOutput.slice(0, CODE_CHANGES_PREVIEW_LENGTH)}\n\n`;
    } else if (dependencyTaskIds && dependencyTaskIds.length > 0) {
      prompt += `## Code Review\nUse \`get_step_output("${dependencyTaskIds[0]}")\` to fetch the developer's output, then review it.\n\n`;
    }
    prompt += `Review this code objectively. Output JSON as specified in your instructions.\n`;
  }

  if (step.role === "fix") {
    if (lastOutput) {
      prompt += `## Issues to Fix\n${lastOutput.slice(0, ISSUES_PREVIEW_LENGTH)}\n\n`;
    } else if (dependencyTaskIds && dependencyTaskIds.length > 0) {
      prompt += `## Fix Task\nUse \`get_step_output("${dependencyTaskIds[0]}")\` to fetch the issues identified, then fix them.\n\n`;
    }
    prompt += `Fix these issues. Report what you changed.\n`;
  }

  if (dependencyTaskIds && dependencyTaskIds.length > 0 && step.role !== "review" && step.role !== "fix") {
    prompt += `## Dependencies\nThis task depends on: ${dependencyTaskIds.join(", ")}. Use \`get_step_output\` to inspect their output if needed.\n\n`;
  }

  if (roleDef?.receivesPlanContext) {
    prompt += `## PM's Task Plan\n${JSON.stringify(plan.tasks, null, 2)}\n\n`;
    prompt += `Execute based on the acceptance criteria. Output structured results as specified in your instructions.\n`;
  }

  if (messageInstructions) {
    prompt += messageInstructions;
  }

  return prompt;
}

// ----- PM Plan JSON types -----

interface PMPlanJSON {
  type: "plan";
  analysis: string;
  tasks: Array<{
    id: string;
    title: string;
    agent: string;
    role: string;
    description: string;
    dependsOn: string[];
    acceptanceCriteria: string[];
    skills?: string[];
    provider?: string;
    model?: string;
  }>;
}

interface PMClarificationJSON {
  type: "clarification";
  questions: string[];
}

interface PMResponseJSON {
  type: "response";
  message: string;
}

type PMPlanOutput = PMPlanJSON | PMClarificationJSON | PMResponseJSON;

// ----- Parser -----

/** Extract PM plan JSON from `[PM_PLAN]...[/PM_PLAN]` markers, with extractJSON fallback. */
function extractPMPlanJSON(raw: string): PMPlanOutput | null {
  // Try [PM_PLAN] markers first
  const blockMatch = raw.match(
    /\[PM_PLAN\]\s*\n?\s*([\s\S]*?)\s*\n?\s*\[\/PM_PLAN\]/,
  );
  if (blockMatch) {
    try {
      return JSON.parse(blockMatch[1]) as PMPlanOutput;
    } catch {
      const json = extractJSON(blockMatch[1]);
      if (json && typeof json === "object" && "type" in json) {
        return json as PMPlanOutput;
      }
    }
  }

  // Fallback: try extractJSON on the whole output
  const json = extractJSON(raw);
  if (json && typeof json === "object" && "type" in json) {
    return json as PMPlanOutput;
  }

  return null;
}

/** Parse PM output into a plan, clarification, or conversational response. */
export function parsePMOutput(raw: string): {
  plan: PMPlan | null;
  clarification: string[] | null;
  response: string | null;
} {
  const parsed = extractPMPlanJSON(raw);
  if (!parsed) {
    const blockMatch = raw.match(
      /\[PM_PLAN\]\s*\n?\s*([\s\S]*?)\s*\n?\s*\[\/PM_PLAN\]/,
    );
    if (blockMatch) {
      const inner = blockMatch[1];
      // Try to salvage clarification questions from malformed JSON
      if (/"type"\s*:\s*"clarification"/.test(inner)) {
        const qMatch = inner.match(/"questions"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (qMatch) {
          return { plan: null, clarification: [qMatch[1]], response: null };
        }
      }
      const msgMatch = inner.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (msgMatch) {
        return { plan: null, clarification: null, response: msgMatch[1] };
      }
      const stripped = raw.replace(/\[PM_PLAN\][\s\S]*?\[\/PM_PLAN\]/g, "").trim();
      return { plan: null, clarification: null, response: stripped || null };
    }
    const trimmed = raw.trim();
    return { plan: null, clarification: null, response: trimmed || null };
  }

  if (parsed.type === "response") {
    return { plan: null, clarification: null, response: parsed.message || null };
  }

  if (parsed.type === "clarification") {
    // Runtime guard: PM may output questions as a single string instead of an array
    const raw_q: unknown = parsed.questions;
    const arr = Array.isArray(raw_q) ? raw_q as string[] : typeof raw_q === "string" && raw_q.trim() ? [raw_q] : [];
    const questions = arr.filter((q) => q.trim().length > 0);
    return { plan: null, clarification: questions.length > 0 ? questions : null, response: null };
  }

  if (parsed.type === "plan") {
    if (!parsed.tasks || parsed.tasks.length === 0) {
      return { plan: null, clarification: null, response: null };
    }

    // Derive pipeline from task agent:role pairs in order
    const pipeline = parsed.tasks.map((t) =>
      t.role ? `${t.agent}:${t.role}` : t.agent,
    );

    const tasks: PMPlanTask[] = parsed.tasks.map((t, idx) => {
      // Normalize dependsOn: accept ["t1","t2"] or [1,2]
      const dependsOn = (t.dependsOn ?? []).map((d) => {
        const n = parseInt(String(d).replace(/^t/i, ""), 10);
        return isNaN(n) ? 0 : n;
      }).filter((n) => n > 0);

      return {
        id: idx + 1,
        title: t.title ?? `Task ${idx + 1}`,
        agent: t.agent ?? "",
        role: t.role ?? "code",
        description: t.description ?? t.title ?? "",
        dependsOn,
        acceptanceCriteria: t.acceptanceCriteria ?? [],
        skills: t.skills,
        provider: t.provider,
        model: t.model,
      };
    });

    return {
      plan: { analysis: parsed.analysis ?? "", tasks, pipeline },
      clarification: null,
      response: null,
    };
  }

  return { plan: null, clarification: null, response: null };
}

// Keep legacy exports for any remaining callers
export function parsePMPlan(raw: string): PMPlan | null {
  return parsePMOutput(raw).plan;
}

export function parseConversationalResponse(raw: string): string | null {
  return parsePMOutput(raw).response;
}

export function parseClarification(raw: string): string[] | null {
  return parsePMOutput(raw).clarification;
}

