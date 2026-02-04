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
  FAILED_OUTPUT_PREVIEW_LENGTH,
} from "@/lib/constants";

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
  eventsContext: string;
  lastOutput: string;
  plan: PMPlan;
  memoryContext?: string;
  inboxContext?: string;
  messageInstructions?: string;
}): string {
  const {
    step,
    task,
    userMessage,
    projectPath,
    eventsContext,
    lastOutput,
    plan,
    memoryContext,
    inboxContext,
    messageInstructions,
  } = opts;

  let prompt = `## Project: ${projectPath}\n\n`;

  prompt += `## Available Tools\n`;
  prompt += `You have access to project data tools. Use them when you need context:\n`;
  prompt += `- **search_project_history**: Search past messages, events, and memories\n`;
  prompt += `- **list_tasks** / **get_task**: View tasks and their details\n`;
  prompt += `- **update_task_status**: Update task status and add notes\n`;
  prompt += `- **get_messages**: Read conversation history (you choose how many)\n`;
  prompt += `- **get_step_output**: Read full output from any past task\n`;
  prompt += `- **get_pipeline_runs**: View past pipeline execution history\n`;
  prompt += `- **get_project_info**: Get project name, path, and current tech stack\n`;
  prompt += `- **update_project_stack**: Update the project's tech stack identifier\n\n`;

  if (memoryContext) {
    prompt += `## Relevant Memories\n${memoryContext}\n\n`;
  }

  if (inboxContext) {
    prompt += inboxContext + "\n\n";
  }

  prompt += `## Event History\n${eventsContext}\n\n`;
  prompt += `## Original User Request\n${userMessage}\n\n`;

  const agentDef = getAgent(step.agent);
  const roleDef = step.role ? agentDef?.roles[step.role] : undefined;

  if (agentDef?.taskPreamble && !task) {
    prompt += `## Your Task\n${agentDef.taskPreamble}\n`;
  } else if (task) {
    prompt += `## Your Task\n**${task.title}**\n${task.description}\n\n`;
    prompt += `## Acceptance Criteria\n${(task.acceptanceCriteria ?? []).map((c) => `- ${c}`).join("\n")}\n\n`;
  }

  if (step.role === "review" && lastOutput) {
    prompt += `## Code Changes to Review (from Developer)\n${lastOutput.slice(0, CODE_CHANGES_PREVIEW_LENGTH)}\n\n`;
    prompt += `Review this code objectively. Output JSON as specified in your instructions.\n`;
  }

  if (step.role === "fix" && lastOutput) {
    prompt += `## Issues to Fix\n${lastOutput.slice(0, ISSUES_PREVIEW_LENGTH)}\n\n`;
    prompt += `Fix these issues. Report what you changed.\n`;
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

// ----- Re-evaluation prompt -----

export function buildReEvalPrompt(
  failedStep: PipelineStep,
  failOutput: string,
  eventsContext: string,
  userMessage: string,
): string {
  return `## Situation
Step "${failedStep.agent}${failedStep.role ? `:${failedStep.role}` : ""}" failed or found issues.

## Failed Step Output
${failOutput.slice(0, FAILED_OUTPUT_PREVIEW_LENGTH)}

## Event History
${eventsContext}

## Original Request
${userMessage}

Re-evaluate and create a fix plan following your re-evaluation Markdown format.`;
}

// ----- Parsers -----

export function parsePMPlan(raw: string): PMPlan | null {
  if (raw.includes("## Clarification Needed")) return null;

  const analysisMatch = raw.match(
    /## (?:Analysis|Action)\s*\n([\s\S]*?)(?=\n## |$)/,
  );
  const analysis = analysisMatch?.[1]?.trim() ?? "";

  const pipelineMatch = raw.match(/## Pipeline\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!pipelineMatch) return null;

  const pipelineLine = pipelineMatch[1].trim().split("\n")[0].trim();
  const pipeline = pipelineLine.split(/\s*→\s*/).filter(Boolean);
  if (pipeline.length === 0) return null;

  const tasksMatch = raw.match(/## Tasks\s*\n([\s\S]*?)$/);
  if (!tasksMatch) return null;

  const taskBlocks = tasksMatch[1].split(/### t?\d+\.\s+/).filter(Boolean);

  const tasks: PMPlanTask[] = taskBlocks.map((block, idx) => {
    const title = block.split("\n")[0]?.trim() ?? `Task ${idx + 1}`;
    const agent =
      block.match(/- Agent:\s*(.+)/)?.[1]?.trim() ??
      pipeline[0]?.split(":")[0] ??
      "";
    const role = block.match(/- Role:\s*(.+)/)?.[1]?.trim() ?? "code";
    const description =
      block.match(/- Description:\s*(.+)/)?.[1]?.trim() ?? title;
    const skills = block
      .match(/- Skills:\s*(.+)/)?.[1]
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const provider = block.match(/- Provider:\s*(.+)/)?.[1]?.trim();
    const model = block.match(/- Model:\s*(.+)/)?.[1]?.trim();

    // Parse DependsOn for task graph
    const dependsOnStr = block.match(/- DependsOn:\s*(.+)/)?.[1]?.trim();
    const dependsOn = dependsOnStr
      ? dependsOnStr
          .split(",")
          .map((s) => parseInt(s.trim().replace(/^t/i, ""), 10))
          .filter((n) => !isNaN(n))
      : [];

    const acMatch = block.match(
      /- Acceptance Criteria:\s*\n((?:\s+-[^\n]+\n?)*)/,
    );
    const acceptanceCriteria = acMatch
      ? (acMatch[1].match(/\s+-\s+(.+)/g) ?? []).map((l) =>
          l.replace(/^\s+-\s+/, "").trim(),
        )
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
      dependsOn,
    };
  });

  if (tasks.length === 0) return null;

  return { analysis, tasks, pipeline };
}

export function parseConversationalResponse(raw: string): string | null {
  const match = raw.match(/## Response\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!match) return null;
  const text = match[1].trim();
  return text.length > 0 ? text : null;
}

export function parseClarification(raw: string): string[] | null {
  const match = raw.match(
    /## Clarification Needed\s*\n([\s\S]*?)(?=\n## |$)/,
  );
  if (!match) return null;

  const questions = match[1]
    .split("\n")
    .map((line) => line.replace(/^-\s+/, "").trim())
    .filter(Boolean);

  return questions.length > 0 ? questions : null;
}

export function parsePipeline(pipeline: string[]): PipelineStep[] {
  return pipeline.map((entry) => {
    const [agent, role] = entry.split(":");
    return { agent, role };
  });
}
