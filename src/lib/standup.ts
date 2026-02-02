/**
 * Standup engine — generates post-pipeline Overwatch scans.
 * Each participating agent scans beyond its task scope for tensions,
 * misalignments, and risks using personality-aware, RAG-enhanced prompts.
 */

import { prisma } from "./prisma";
import { runLLM } from "./llm";
import { getCheapestAvailableModel } from "./providers";
import { calculateCost } from "./cost-calculator";
import { logEvent } from "./event-log";
import {
  getRelationshipContext,
  getPersonality,
} from "./personality";
import { queryMemories, formatMemoriesForPrompt } from "./memory";
import { storeMemory } from "./memory";
import { getAgentRegistry } from "./agent-loader";
import type { ProjectSettings } from "@/types/settings";
import { AGENT } from "@/lib/models";

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

interface StepInfo {
  agent: string;
  role?: string;
  title: string;
  status: string;
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

interface GenerateStandupOpts {
  pipelineRunId: string;
  projectId: string;
  userMessage: string;
  steps: StepInfo[];
  plan: PlanInfo;
  fixCycleCount: number;
  totalCost: number;
  settings?: ProjectSettings;
}

// --- Codename Resolution ---

function getCodename(agentType: string): string {
  const personality = getPersonality(agentType);
  return personality?.codename ?? agentType;
}

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

const AGENT_LENSES: Record<string, string> = {
  [AGENT.PM]: `## Your Overwatch Lens: Process Efficiency

Scan the entire pipeline for PROCESS tensions:

- Were there unnecessary steps? (architect called for a trivial change)
- Did fix cycles indicate poor upfront specification?
- Was the pipeline ordering suboptimal? (review found issues that better
  acceptance criteria would have prevented)
- Did any agent take significantly longer than expected?
- Were skills assigned effectively, or did agents lack context they needed?`,

  [AGENT.ARCHITECT]: `## Your Overwatch Lens: Design Integrity

Scan the entire pipeline for DESIGN tensions:

- Did the implementation deviate from agreed architectural patterns?
- Are there consistency violations? (different patterns used for similar problems)
- Did new code introduce dependencies that conflict with the tech stack decisions?
- Are there scaling concerns in the implementation approach?
- Did the folder structure or module boundaries get violated?`,

  [AGENT.DEVELOPER]: `## Your Overwatch Lens: Code Quality & Consistency

Scan the entire pipeline for CODE QUALITY tensions:

- Are there duplicate utilities or redundant libraries?
- Did new code follow different patterns than existing code? (naming conventions,
  error handling approaches, API response formats)
- Are there performance concerns? (N+1 queries, unnecessary re-renders,
  missing indexes)
- Is there dead code or unused imports introduced?
- Are there missing edge cases in the implementation?`,

  [AGENT.QA]: `## Your Overwatch Lens: User Experience & Reliability

Scan the entire pipeline for USER-FACING tensions:

- Are there missing loading states, error boundaries, or empty states?
- Do new UI elements have proper accessibility attributes?
- Are there user flows that could result in confusing or broken states?
- Did the implementation miss edge cases in the acceptance criteria?
- Are there race conditions or timing issues in async operations?`,
};

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
  lines.push(`Output format (JSON array):
[
  {
    "to": "<teammate name>",
    "insight_type": "<cross-concern|pattern|process|drift|risk>",
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

  // Agent-specific lens
  const lens = AGENT_LENSES[agentType] ?? AGENT_LENSES.developer;
  lines.push("");
  lines.push(lens);

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
        limit: 5,
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
      lines.push(s.output.slice(0, 2000));
    }
  }

  if (otherSteps.length > 0) {
    lines.push("");
    lines.push("## Other Agents' Results");
    for (const s of otherSteps) {
      const label = s.role ? `${s.agent}:${s.role}` : s.agent;
      lines.push(`\n**${label}** (${s.status}): ${s.title}`);
      lines.push(s.output.slice(0, 1500));
    }
  }

  lines.push("");
  lines.push(
    "Now perform your Overwatch scan. Write in your voice. Output ONLY the JSON array."
  );

  return lines.join("\n");
}

// --- JSON Parser ---

function parseStandupJSON(raw: string): StandupInsight[] {
  // Try direct parse
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    // Try extracting from markdown code block
  }

  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      return [parsed];
    } catch {
      // fall through
    }
  }

  // Try finding array in the text
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // fall through
    }
  }

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
  const { model } = await getCheapestAvailableModel();
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
        });

        const llmResult = await runLLM({
          prompt,
          systemPrompt,
          model,
          maxTokens: 1024,
          agentLabel: `standup:${participant.agent}`,
        });

        const insights = parseStandupJSON(llmResult.text);
        const cost = llmResult.tokensUsed
          ? calculateCost(model, llmResult.tokensUsed)
          : 0;
        const tokens = llmResult.tokensUsed
          ? llmResult.tokensUsed.inputTokens + llmResult.tokensUsed.outputTokens
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
