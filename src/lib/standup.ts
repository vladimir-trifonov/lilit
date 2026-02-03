/**
 * Standup engine — generates post-pipeline Overwatch scans.
 * Each participating agent scans beyond its task scope for tensions,
 * misalignments, and risks using personality-aware, RAG-enhanced prompts.
 */

import { prisma } from "./prisma";
import { getAdapter, getCheapestAvailableModel } from "./providers/index";
import { calculateCost } from "./cost-calculator";
import { logEvent } from "./event-log";
import {
  getRelationshipContext,
  getPersonality,
  getCodename,
} from "./personality";
import { queryMemories, formatMemoriesForPrompt } from "./memory";
import { storeMemory } from "./memory";
import { getAgent, getAgentRegistry } from "./agent-loader";
import { extractJSON } from "./utils";
import type { ProjectSettings } from "@/types/settings";
import { type StepInfo as BaseStepInfo } from "@/types/pipeline";
import { AGENT } from "@/lib/models";
import {
  STANDUP_RAG_LIMIT,
  OWN_STEP_RESULTS_LENGTH,
  OTHER_STEP_RESULTS_LENGTH,
  STANDUP_MAX_TOKENS,
} from "@/lib/constants";

// --- Types ---

interface StandupInsight {
  to: string;
  insight_type: string;
  message: string;
  actionable: boolean;
}

export interface StandupMessageData {
  id: string;
  fromAgent: string;
  fromCodename: string;
  fromRole?: string;
  toAgent: string;
  toCodename: string;
  insightType: string;
  message: string;
  actionable: boolean;
  feedback?: string | null;
  model: string;
  costUsd: number;
}

export interface StandupResult {
  messages: StandupMessageData[];
  totalCost: number;
}

interface StepInfo extends BaseStepInfo {
  output: string;
}

interface PlanInfo {
  analysis: string;
  tasks: Array<{
    title: string;
    description: string;
    agent: string;
    role: string;
  }>;
}

interface DebateInfo {
  challengerAgent: string;
  defenderAgent: string;
  triggerOpinion: string;
  outcome: string;
  turns: Array<{ agent: string; messageType: string; content: string }>;
  resolutionNote?: string;
}

interface GenerateStandupOpts {
  pipelineRunId: string;
  projectId: string;
  userMessage: string;
  steps: StepInfo[];
  plan: PlanInfo;
  fixCycleCount: number;
  totalCost: number;
  settings?: ProjectSettings;
  debates?: DebateInfo[];
}

// --- Codename Resolution ---

function getCodenameMap(): Record<string, string> {
  const registry = getAgentRegistry();
  const map: Record<string, string> = {};
  for (const [type, def] of Object.entries(registry)) {
    map[type] = def.personality?.codename ?? type;
  }
  return map;
}

function agentTypeFromCodename(
  codename: string,
  codenameMap: Record<string, string>
): string {
  for (const [type, name] of Object.entries(codenameMap)) {
    if (name.toLowerCase() === codename.toLowerCase()) return type;
  }
  return codename.toLowerCase();
}

// --- Prompt Templates ---

const OVERWATCH_PREAMBLE = `Your job is NOT to summarize what you did -- that information already exists.
Your job is to apply your domain expertise to the ENTIRE pipeline context and
detect TENSIONS, MISALIGNMENTS, or RISKS that nobody explicitly asked you to check.

Rules:
1. You are writing a message TO a specific teammate. Pick the most relevant
   recipient for your observation. Use their name.
2. If you genuinely see no tensions, say so explicitly. Output the "no tension"
   JSON format. Do NOT generate polite filler.
3. Be specific and actionable. "Consider adding error handling" is useless.
   "The /api/users endpoint has no try-catch around the database call on line 47
   of src/routes/users.ts" is useful.
4. Keep your message under 200 words. Concise observations, not essays.
5. You may produce multiple insights (up to 3). Output a JSON array.
6. Stay in character but never let personality override technical accuracy.`;

const GENERIC_FALLBACK = {
  lens: "General Quality",
  focus: [
    "Are there inconsistencies between this step's output and prior steps?",
    "Were there signs of miscommunication or unclear requirements?",
    "Are there risks or technical debt introduced?",
  ],
};

/** Build the overwatch lens section for an agent, preferring AGENT.md frontmatter. */
function getAgentLens(agentType: string): string {
  const agent = getAgent(agentType);
  const overwatchLens = agent?.overwatchLens;
  const overwatchFocus = agent?.overwatchFocus;

  if (overwatchLens && overwatchFocus?.length) {
    const focusItems = overwatchFocus.map((f) => `- ${f}`).join("\n");
    return `## Your Overwatch Lens: ${overwatchLens}\n\nScan the entire pipeline for tensions:\n\n${focusItems}`;
  }

  const focusItems = GENERIC_FALLBACK.focus.map((f) => `- ${f}`).join("\n");
  return `## Your Overwatch Lens: ${GENERIC_FALLBACK.lens}\n\nScan the entire pipeline for tensions:\n\n${focusItems}`;
}

// --- Prompt Builder ---

async function buildOverwatchPrompt(opts: {
  agentType: string;
  projectId: string;
  userMessage: string;
  steps: StepInfo[];
  pipelineStatus: string;
  fixCycleCount: number;
  totalCost: number;
  participants: Array<{ agent: string; codename: string }>;
  personalityEnabled: boolean;
  debates?: DebateInfo[];
}): Promise<string> {
  const {
    agentType,
    projectId,
    userMessage,
    steps,
    pipelineStatus,
    fixCycleCount,
    totalCost,
    participants,
    personalityEnabled,
    debates,
  } = opts;

  const codename = getCodename(agentType);
  const lines: string[] = [];

  // Identity line
  if (personalityEnabled) {
    const personality = getPersonality(agentType);
    const voiceStyle = personality?.voice
      ? `${personality.voice.style}, ${personality.voice.tone}`
      : "";
    lines.push(
      `You are ${codename}, performing an Overwatch scan after a pipeline run.${voiceStyle ? ` Communication style: ${voiceStyle}.` : ""}`
    );
  } else {
    lines.push(
      `You are the ${agentType}, performing an Overwatch scan after a pipeline run.`
    );
  }

  lines.push("");
  lines.push(OVERWATCH_PREAMBLE);

  // Team members
  lines.push("");
  lines.push("Team members:");
  for (const p of participants) {
    if (p.agent !== agentType) {
      lines.push(`- ${p.codename} (${p.agent})`);
    }
  }

  // Output format
  lines.push("");
  lines.push(`Write TO a specific teammate by name. Be direct.
If you think someone's work was subpar, say so.
If a debate outcome was wrong, flag it.

Output format (JSON array):
[
  {
    "to": "<teammate name>",
    "insight_type": "<cross-concern|pattern|process|drift|risk|debate-follow-up>",
    "message": "<your observation>",
    "actionable": <true|false>
  }
]

If no tensions detected:
[
  {
    "to": "none",
    "insight_type": "none",
    "message": "No tensions detected.",
    "actionable": false
  }
]`);

  // Agent-specific lens (frontmatter-driven with fallback)
  lines.push("");
  lines.push(getAgentLens(agentType));

  // Relationship context
  if (personalityEnabled) {
    try {
      const relCtx = await getRelationshipContext(projectId, agentType);
      if (relCtx) {
        lines.push("");
        lines.push("## Your Relationship Context");
        lines.push(relCtx);
      }
    } catch {
      // non-fatal
    }
  }

  // RAG memories
  if (personalityEnabled) {
    try {
      const memories = await queryMemories({
        projectId,
        query: `${agentType} overwatch scan for: ${userMessage}`,
        agent: agentType,
        types: ["decision", "code_pattern"],
        limit: STANDUP_RAG_LIMIT,
      });
      const memCtx = formatMemoriesForPrompt(memories);
      if (memCtx) {
        lines.push("");
        lines.push("## What You Remember");
        lines.push(memCtx);
      }
    } catch {
      // non-fatal
    }
  }

  // Pipeline context
  lines.push("");
  lines.push("## Pipeline Context");
  lines.push("");
  lines.push(`**Original User Request:**\n${userMessage}`);
  lines.push("");
  lines.push(`**Pipeline Outcome:** ${pipelineStatus}`);
  lines.push(`**Fix Cycles:** ${fixCycleCount}`);
  lines.push(`**Total Cost:** $${totalCost.toFixed(4)}`);
  lines.push("");
  lines.push(
    `**Participating Team:** ${participants.map((p) => `${p.codename} (${p.agent})`).join(", ")}`
  );

  // Step results split into own vs. others
  const ownSteps = steps.filter((s) => s.agent === agentType);
  const otherSteps = steps.filter(
    (s) => s.agent !== agentType && s.agent !== AGENT.PM
  );

  if (ownSteps.length > 0) {
    lines.push("");
    lines.push("## Your Step Results");
    for (const s of ownSteps) {
      const label = s.role ? `${s.agent}:${s.role}` : s.agent;
      lines.push(`\n**${label}** (${s.status}): ${s.title}`);
      lines.push(s.output.slice(0, OWN_STEP_RESULTS_LENGTH));
    }
  }

  if (otherSteps.length > 0) {
    lines.push("");
    lines.push("## Other Agents' Results");
    for (const s of otherSteps) {
      const label = s.role ? `${s.agent}:${s.role}` : s.agent;
      lines.push(`\n**${label}** (${s.status}): ${s.title}`);
      lines.push(s.output.slice(0, OTHER_STEP_RESULTS_LENGTH));
    }
  }

  // Debate context
  if (debates && debates.length > 0) {
    lines.push("");
    lines.push("## Debates This Run");
    for (const debate of debates) {
      const challengerName = participants.find((p) => p.agent === debate.challengerAgent)?.codename ?? debate.challengerAgent;
      const defenderName = participants.find((p) => p.agent === debate.defenderAgent)?.codename ?? debate.defenderAgent;
      lines.push(`\n**${challengerName} vs ${defenderName}** (outcome: ${debate.outcome})`);
      lines.push(`Trigger: "${debate.triggerOpinion}"`);
      if (debate.resolutionNote) {
        lines.push(`Resolution: ${debate.resolutionNote.slice(0, 200)}`);
      }
    }
    lines.push("");
    lines.push("Debate-specific questions:");
    lines.push("- Did any debate outcomes get ignored in subsequent steps?");
    lines.push("- Are the same disagreements recurring? Should this become a convention?");
    lines.push("- Did a debate lead to better or worse outcomes?");
  }

  lines.push("");
  lines.push(
    "Now perform your Overwatch scan. Write in your voice. Output ONLY the JSON array."
  );

  return lines.join("\n");
}

// --- JSON Parser ---

function parseStandupJSON(raw: string): StandupInsight[] {
  const parsed = extractJSON(raw);
  if (parsed === null) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object") return [parsed as StandupInsight];
  return [];
}

// --- Main Entry ---

export async function generateStandup(
  opts: GenerateStandupOpts
): Promise<StandupResult> {
  const {
    pipelineRunId,
    projectId,
    userMessage,
    steps,
    fixCycleCount,
    totalCost,
    settings,
    debates,
  } = opts;

  const personalityEnabled = settings?.personalityEnabled !== false;

  // 1. Determine participating agents (deduplicate by agent type).
  // Exclude PM unless PM had a real execution step (not just the plan step).
  const agentTypes = new Set<string>();
  for (const step of steps) {
    if (step.agent === AGENT.PM && step.title === "Execution Plan") continue;
    agentTypes.add(step.agent);
  }

  const codenameMap = getCodenameMap();
  const participants = Array.from(agentTypes).map((agent) => ({
    agent,
    codename: codenameMap[agent] ?? agent,
  }));

  if (participants.length === 0) {
    return { messages: [], totalCost: 0 };
  }

  // 2. Determine pipeline status
  const pipelineStatus = steps.every((s) => s.status === "done")
    ? "SUCCESS"
    : "PARTIAL FAILURE";

  // 3. Generate all standup messages in parallel
  const { provider, model } = await getCheapestAvailableModel();
  const adapter = getAdapter(provider);
  const systemPrompt =
    "You are a senior software professional performing a post-pipeline Overwatch scan. Output ONLY valid JSON.";

  const results = await Promise.all(
    participants.map(async (participant) => {
      try {
        const prompt = await buildOverwatchPrompt({
          agentType: participant.agent,
          projectId,
          userMessage,
          steps,
          pipelineStatus,
          fixCycleCount,
          totalCost,
          participants,
          personalityEnabled,
          debates,
        });

        const adapterResult = await adapter.execute({
          prompt,
          systemPrompt,
          model,
          maxTokens: STANDUP_MAX_TOKENS,
          agentLabel: `standup:${participant.agent}`,
        });

        const insights = parseStandupJSON(adapterResult.output);
        const cost = adapterResult.tokensUsed
          ? calculateCost(model, adapterResult.tokensUsed)
          : 0;
        const tokens = adapterResult.tokensUsed
          ? adapterResult.tokensUsed.inputTokens + adapterResult.tokensUsed.outputTokens
          : 0;
        const costPerInsight = insights.length > 0 ? cost / insights.length : 0;
        const tokensPerInsight =
          insights.length > 0 ? Math.round(tokens / insights.length) : 0;

        return {
          agent: participant.agent,
          codename: participant.codename,
          insights,
          costPerInsight,
          tokensPerInsight,
        };
      } catch {
        // Individual agent failure is non-fatal
        return {
          agent: participant.agent,
          codename: participant.codename,
          insights: [],
          costPerInsight: 0,
          tokensPerInsight: 0,
        };
      }
    })
  );

  // 4. Store in database
  let standupTotalCost = 0;
  const storedMessages: StandupMessageData[] = [];

  for (const result of results) {
    for (const insight of result.insights) {
      const toAgentType = agentTypeFromCodename(insight.to, codenameMap);
      const toCodename =
        insight.to === "none" ? "none" : (codenameMap[toAgentType] ?? insight.to);

      const record = await prisma.standupMessage.create({
        data: {
          pipelineRunId,
          fromAgent: result.agent,
          toAgent: toAgentType,
          insightType: insight.insight_type ?? "none",
          message: insight.message ?? "No tensions detected.",
          actionable: insight.actionable ?? false,
          model,
          costUsd: result.costPerInsight,
          tokensUsed: result.tokensPerInsight,
        },
      });

      const msg: StandupMessageData = {
        id: record.id,
        fromAgent: result.agent,
        fromCodename: result.codename,
        toAgent: toAgentType,
        toCodename,
        insightType: insight.insight_type ?? "none",
        message: insight.message ?? "No tensions detected.",
        actionable: insight.actionable ?? false,
        feedback: null,
        model,
        costUsd: result.costPerInsight,
      };

      storedMessages.push(msg);
      standupTotalCost += result.costPerInsight;
    }
  }

  // 5. Log event
  await logEvent({
    projectId,
    agent: "orchestrator",
    type: "standup_generated",
    data: {
      pipelineRunId,
      messageCount: storedMessages.length,
      noTensionCount: storedMessages.filter((m) => m.insightType === "none")
        .length,
      totalCost: standupTotalCost,
    },
  });

  // 6. Ingest actionable insights into RAG memory (fire-and-forget)
  for (const msg of storedMessages) {
    if (msg.insightType !== "none") {
      storeMemory({
        projectId,
        agent: msg.fromAgent,
        type: "decision",
        title: `[Standup] ${msg.fromCodename} \u2192 ${msg.toCodename}: ${msg.insightType}`,
        content: msg.message,
        sourceType: "event_log",
        sourceId: `standup:${msg.id}`,
        significance: msg.actionable ? 0.7 : 0.4,
      }).catch(() => {});
    }
  }

  return { messages: storedMessages, totalCost: standupTotalCost };
}
