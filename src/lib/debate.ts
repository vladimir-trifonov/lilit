/**
 * Debate engine — triggers and runs inter-agent debates when step output
 * conflicts with another agent's opinions.
 *
 * Flow: detectOpinionConflicts -> evaluateDebateTriggers -> runDebateRound
 *       -> storeDebateRound -> ingestDebateMemory -> updateDebateRelationships
 */

import { prisma } from "./prisma";
import { clamp, extractJSON } from "./utils";
import { getAgentRegistry } from "./agent-loader";
import { getAdapter, getCheapestAvailableModel } from "./providers/index";
import { getPersonality, getRelationshipContext } from "./personality";
import { getOrBootstrapPersonality } from "./personality-bootstrap";
import { storeMemory, queryMemories, formatMemoriesForPrompt } from "./memory";
import { calculateCost } from "./cost-calculator";
import type { ProjectSettings } from "@/types/settings";
import {
  DEBATE_MAX_TURNS,
  DEBATE_MAX_PER_STEP,
  DEBATE_MAX_PER_RUN,
  DEBATE_MIN_BUDGET_REMAINING,
  DEBATE_TURN_MAX_TOKENS,
  DEBATE_KEYWORD_CONFIDENCE_THRESHOLD,
  DEBATE_TENSION_MULTIPLIER,
  DEBATE_RAPPORT_MULTIPLIER,
  DEBATE_OUTPUT_SNIPPET_LENGTH,
  DEBATE_TURN_MAX_LENGTH,
  DEBATE_RAG_LIMIT,
  SIGNIFICANCE_DEBATE_REVISED,
  SIGNIFICANCE_DEBATE_ACCEPTED,
  SIGNIFICANCE_DEBATE_COMPROMISE,
  SIGNIFICANCE_DEBATE_ESCALATED,
  TENSION_RISE_DEBATE_CHALLENGE,
  TENSION_DROP_DEBATE_CONCEDE,
  RAPPORT_BOOST_DEBATE_COMPROMISE,
  TRUST_BOOST_DEBATE_ACCEPTED,
  TRUST_DROP_DEBATE_ESCALATED,
} from "@/lib/constants";

// --- Types ---

export interface OpinionConflict {
  challengerAgent: string;
  defenderAgent: string;
  triggerOpinion: string;
  conflictSnippet: string;
  confidence: number;
}

export interface DebateTurn {
  agent: string;
  messageType: "challenge" | "counter" | "concede" | "escalate" | "moderate";
  content: string;
}

export interface DebateRoundResult {
  pipelineRunId: string;
  challengerAgent: string;
  defenderAgent: string;
  triggerOpinion: string;
  conflictSnippet: string;
  outcome: "accepted" | "revised" | "compromise" | "escalated";
  turns: DebateTurn[];
  resolutionNote?: string;
  costUsd: number;
  stepIndex: number;
  debateId: string;
}

interface EvaluateTriggersOpts {
  projectId: string;
  pipelineRunId: string;
  stepIndex: number;
  step: { agent: string; role?: string };
  stepOutput: string;
  settings?: ProjectSettings;
  runningCost: number;
  budgetLimit?: number;
  debatesThisRun: number;
}

// --- Opinion Matching ---

interface OpinionEntry {
  agentType: string;
  opinion: string;
  keywords: string[];
}

let cachedOpinionIndex: OpinionEntry[] | null = null;

/** Build a keyword index of all agents' opinions and dislikes. */
function buildOpinionIndex(): OpinionEntry[] {
  if (cachedOpinionIndex) return cachedOpinionIndex;

  const registry = getAgentRegistry();
  const entries: OpinionEntry[] = [];

  for (const [type, def] of Object.entries(registry)) {
    const personality = def.personality;
    if (!personality) continue;

    const opinions = [
      ...(personality.opinions?.strong ?? []),
      ...(personality.opinions?.dislikes ?? []),
      ...(personality.quirks?.pet_peeves ?? []),
    ];

    for (const opinion of opinions) {
      const keywords = tokenize(opinion);
      if (keywords.length > 0) {
        entries.push({ agentType: type, opinion, keywords });
      }
    }
  }

  cachedOpinionIndex = entries;
  return entries;
}

/** Invalidate the cached opinion index (call after registry refresh). */
export function invalidateOpinionIndex(): void {
  cachedOpinionIndex = null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/**
 * Keyword-scan output against other agents' opinions.
 * Returns conflicts with confidence scores.
 */
function detectOpinionConflicts(
  stepOutput: string,
  executingAgent: string,
  aggressiveness: number,
): OpinionConflict[] {
  const index = buildOpinionIndex();
  const outputLower = stepOutput.toLowerCase();
  const outputTokens = new Set(tokenize(stepOutput));
  const conflicts: OpinionConflict[] = [];

  for (const entry of index) {
    // Don't trigger debates with yourself
    if (entry.agentType === executingAgent) continue;

    // Keyword overlap scoring
    const matchCount = entry.keywords.filter((kw) => outputTokens.has(kw) || outputLower.includes(kw)).length;
    const confidence = entry.keywords.length > 0 ? matchCount / entry.keywords.length : 0;

    // Adjust threshold by aggressiveness (0-1)
    const threshold = DEBATE_KEYWORD_CONFIDENCE_THRESHOLD * (1 - aggressiveness * 0.4);

    if (confidence >= threshold) {
      // Extract the relevant snippet from output
      const firstKeyword = entry.keywords.find((kw) => outputLower.includes(kw));
      const snippetStart = firstKeyword ? Math.max(0, outputLower.indexOf(firstKeyword) - 100) : 0;
      const snippet = stepOutput.slice(snippetStart, snippetStart + DEBATE_OUTPUT_SNIPPET_LENGTH);

      conflicts.push({
        challengerAgent: entry.agentType,
        defenderAgent: executingAgent,
        triggerOpinion: entry.opinion,
        conflictSnippet: snippet,
        confidence,
      });
    }
  }

  // Sort by confidence descending, take top candidates
  return conflicts.sort((a, b) => b.confidence - a.confidence);
}

// --- Debate Trigger Evaluation ---

/**
 * Entry point called from orchestrator after each step.
 * Detects conflicts, filters by budget/limits, returns debates to run.
 */
export async function evaluateDebateTriggers(
  opts: EvaluateTriggersOpts,
): Promise<OpinionConflict[]> {
  const {
    projectId,
    stepOutput,
    step,
    settings,
    runningCost,
    budgetLimit,
    debatesThisRun,
  } = opts;

  // Check global limits
  if (debatesThisRun >= DEBATE_MAX_PER_RUN) return [];

  // Check budget
  const remaining = (budgetLimit ?? Infinity) - runningCost;
  if (remaining < DEBATE_MIN_BUDGET_REMAINING) return [];

  const aggressiveness = settings?.debateAggressiveness ?? 0.5;
  const conflicts = detectOpinionConflicts(stepOutput, step.agent, aggressiveness);

  if (conflicts.length === 0) return [];

  // Adjust by relationship dynamics
  const adjustedConflicts: OpinionConflict[] = [];
  for (const conflict of conflicts) {
    try {
      const rel = await prisma.agentRelationship.findFirst({
        where: {
          projectId,
          fromAgent: conflict.challengerAgent,
          toAgent: conflict.defenderAgent,
        },
      });

      if (rel) {
        // High tension lowers the threshold (more likely to debate)
        // High rapport raises it (less likely)
        let adjustedConfidence = conflict.confidence;
        if (rel.tension > 0.3) adjustedConfidence *= (1 / DEBATE_TENSION_MULTIPLIER);
        if (rel.rapport > 0.7) adjustedConfidence *= (1 / DEBATE_RAPPORT_MULTIPLIER);
        adjustedConflicts.push({ ...conflict, confidence: adjustedConfidence });
      } else {
        adjustedConflicts.push(conflict);
      }
    } catch {
      adjustedConflicts.push(conflict);
    }
  }

  // Cap per-step
  return adjustedConflicts.slice(0, DEBATE_MAX_PER_STEP);
}

// --- Debate Execution ---

/**
 * Execute a single debate round between challenger and defender.
 */
export async function runDebateRound(opts: {
  conflict: OpinionConflict;
  pipelineRunId: string;
  projectId: string;
  stepIndex: number;
}): Promise<DebateRoundResult> {
  const { conflict, pipelineRunId, projectId, stepIndex } = opts;
  const debateId = `debate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const turns: DebateTurn[] = [];
  let totalCost = 0;
  let outcome: DebateRoundResult["outcome"] = "accepted";

  const { provider, model } = await getCheapestAvailableModel();
  const adapter = getAdapter(provider);

  // Turn 1: Challenge
  const challengePrompt = await buildChallengePrompt(
    projectId, conflict.challengerAgent, conflict.defenderAgent,
    conflict.triggerOpinion, conflict.conflictSnippet,
  );

  const challengeResult = await adapter.execute({
    prompt: challengePrompt,
    systemPrompt: "You are an opinionated software professional in a team debate. Be direct and specific. Output ONLY a JSON object.",
    model,
    maxTokens: DEBATE_TURN_MAX_TOKENS,
    agentLabel: `debate:${conflict.challengerAgent}`,
  });

  const challengeCost = challengeResult.tokensUsed ? calculateCost(model, challengeResult.tokensUsed) : 0;
  totalCost += challengeCost;

  const challengeTurn = parseDebateTurn(challengeResult.output, conflict.challengerAgent, "challenge");
  turns.push(challengeTurn);

  // Store challenge as agent message
  await storeDebateMessage(pipelineRunId, conflict.challengerAgent, conflict.defenderAgent, challengeTurn, stepIndex, debateId);

  // Turn 2: Counter/Concede/Escalate
  if (turns.length < DEBATE_MAX_TURNS) {
    const counterPrompt = await buildCounterPrompt(
      projectId, conflict.defenderAgent, conflict.challengerAgent,
      conflict.triggerOpinion, challengeTurn.content, conflict.conflictSnippet,
    );

    const counterResult = await adapter.execute({
      prompt: counterPrompt,
      systemPrompt: "You are defending your work in a team debate. Be honest — concede if the criticism is valid. Output ONLY a JSON object.",
      model,
      maxTokens: DEBATE_TURN_MAX_TOKENS,
      agentLabel: `debate:${conflict.defenderAgent}`,
    });

    const counterCost = counterResult.tokensUsed ? calculateCost(model, counterResult.tokensUsed) : 0;
    totalCost += counterCost;

    const counterTurn = parseDebateTurn(counterResult.output, conflict.defenderAgent, "counter");
    turns.push(counterTurn);

    await storeDebateMessage(pipelineRunId, conflict.defenderAgent, conflict.challengerAgent, counterTurn, stepIndex, debateId);

    // Determine outcome from counter response
    if (counterTurn.messageType === "concede") {
      outcome = "revised";
    } else if (counterTurn.messageType === "escalate") {
      outcome = "escalated";
      // Turn 3: PM moderation
      const moderatePrompt = await buildModerationPrompt(
        projectId, conflict, turns,
      );

      const moderateResult = await adapter.execute({
        prompt: moderatePrompt,
        systemPrompt: "You are the PM moderating a team debate. Make a binding decision. Output ONLY a JSON object.",
        model,
        maxTokens: DEBATE_TURN_MAX_TOKENS,
        agentLabel: "debate:pm-moderate",
      });

      const moderateCost = moderateResult.tokensUsed ? calculateCost(model, moderateResult.tokensUsed) : 0;
      totalCost += moderateCost;

      const moderateTurn = parseDebateTurn(moderateResult.output, "pm", "moderate");
      turns.push(moderateTurn);

      await storeDebateMessage(pipelineRunId, "pm", conflict.challengerAgent, moderateTurn, stepIndex, debateId);

      // PM decides outcome
      const lower = moderateTurn.content.toLowerCase();
      if (lower.includes("compromise")) outcome = "compromise";
      else if (lower.includes("accept") || lower.includes("challenger is right")) outcome = "revised";
      else outcome = "accepted";
    } else {
      // Counter means they disagree — compromise
      outcome = "compromise";
    }
  }

  const resolutionNote = turns[turns.length - 1]?.content.slice(0, DEBATE_TURN_MAX_LENGTH);

  return {
    pipelineRunId,
    challengerAgent: conflict.challengerAgent,
    defenderAgent: conflict.defenderAgent,
    triggerOpinion: conflict.triggerOpinion,
    conflictSnippet: conflict.conflictSnippet.slice(0, DEBATE_OUTPUT_SNIPPET_LENGTH),
    outcome,
    turns,
    resolutionNote,
    costUsd: totalCost,
    stepIndex,
    debateId,
  };
}

// --- Prompt Builders ---

async function buildChallengePrompt(
  projectId: string,
  challengerAgent: string,
  defenderAgent: string,
  triggerOpinion: string,
  conflictSnippet: string,
): Promise<string> {
  const personality = await getOrBootstrapPersonality(projectId, challengerAgent);
  const codename = personality?.codename ?? challengerAgent;
  const defenderPersonality = getPersonality(defenderAgent);
  const defenderName = defenderPersonality?.codename ?? defenderAgent;

  let relContext = "";
  try {
    relContext = await getRelationshipContext(projectId, challengerAgent);
  } catch { /* non-fatal */ }

  let pastDebates = "";
  try {
    const memories = await queryMemories({
      projectId,
      query: `debate between ${challengerAgent} and ${defenderAgent}`,
      agent: challengerAgent,
      types: ["debate"],
      limit: DEBATE_RAG_LIMIT,
    });
    if (memories.length > 0) {
      pastDebates = `\n## Past Debates\n${formatMemoriesForPrompt(memories)}\n`;
    }
  } catch { /* non-fatal */ }

  return `You are ${codename} (${challengerAgent}). You have a strong opinion:
"${triggerOpinion}"

${defenderName} (${defenderAgent}) just produced work that conflicts with this opinion:

---
${conflictSnippet.slice(0, DEBATE_OUTPUT_SNIPPET_LENGTH)}
---

${relContext ? `## Your Relationship with ${defenderName}\n${relContext}\n` : ""}
${pastDebates}
Challenge their work. Be specific about what you disagree with and why.
Stay professional but do not hold back.

Output JSON:
{
  "action": "challenge",
  "message": "Your specific objection (max 200 words)"
}`;
}

async function buildCounterPrompt(
  projectId: string,
  defenderAgent: string,
  challengerAgent: string,
  triggerOpinion: string,
  challengeContent: string,
  originalSnippet: string,
): Promise<string> {
  const personality = await getOrBootstrapPersonality(projectId, defenderAgent);
  const codename = personality?.codename ?? defenderAgent;
  const challengerPersonality = getPersonality(challengerAgent);
  const challengerName = challengerPersonality?.codename ?? challengerAgent;

  return `You are ${codename} (${defenderAgent}). ${challengerName} (${challengerAgent}) is challenging your work.

Their objection: "${challengeContent}"
Their opinion: "${triggerOpinion}"

Your original output that triggered this:
---
${originalSnippet.slice(0, DEBATE_OUTPUT_SNIPPET_LENGTH)}
---

You have three options:
1. COUNTER — Defend your work with specific reasoning
2. CONCEDE — Accept the criticism if it is valid
3. ESCALATE — Ask the PM to make a binding decision

Be honest. If the criticism is valid, concede gracefully. If not, defend with specifics.

Output JSON:
{
  "action": "counter" | "concede" | "escalate",
  "message": "Your response (max 200 words)"
}`;
}

async function buildModerationPrompt(
  projectId: string,
  conflict: OpinionConflict,
  turns: DebateTurn[],
): Promise<string> {
  const personality = await getOrBootstrapPersonality(projectId, "pm");
  const codename = personality?.codename ?? "PM";

  const transcript = turns
    .map((t) => `[${t.agent}] (${t.messageType}): ${t.content}`)
    .join("\n\n");

  return `You are ${codename} (PM), moderating a team debate.

## The Debate
Trigger opinion: "${conflict.triggerOpinion}"
Challenger: ${conflict.challengerAgent}
Defender: ${conflict.defenderAgent}

## Transcript
${transcript}

## Your Task
Make a binding decision. Consider:
- Is the criticism technically valid?
- Does the current approach serve the project goals?
- Is there a compromise that captures both perspectives?

Output JSON:
{
  "action": "moderate",
  "decision": "accept_challenge" | "accept_defense" | "compromise",
  "message": "Your ruling and reasoning (max 200 words)"
}`;
}

// --- Parsers ---

function parseDebateTurn(
  output: string,
  agent: string,
  defaultType: DebateTurn["messageType"],
): DebateTurn {
  const parsed = extractJSON(output);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const action = (obj.action as string)?.toLowerCase();
    const messageType: DebateTurn["messageType"] =
      action === "concede" ? "concede" :
      action === "escalate" ? "escalate" :
      action === "moderate" ? "moderate" :
      action === "counter" ? "counter" :
      defaultType;

    return {
      agent,
      messageType,
      content: ((obj.message ?? obj.content ?? output) as string).slice(0, DEBATE_TURN_MAX_LENGTH),
    };
  }

  return {
    agent,
    messageType: defaultType,
    content: output.slice(0, DEBATE_TURN_MAX_LENGTH),
  };
}

// --- Storage ---

async function storeDebateMessage(
  pipelineRunId: string,
  fromAgent: string,
  toAgent: string,
  turn: DebateTurn,
  phase: number,
  debateId: string,
): Promise<void> {
  await prisma.agentMessage.create({
    data: {
      pipelineRunId,
      fromAgent,
      toAgent,
      messageType: turn.messageType,
      content: turn.content,
      phase,
      debateId,
      debateRole: turn.messageType === "moderate" ? "moderator" :
        turn.messageType === "challenge" ? "challenger" : "defender",
    },
  });
}

/** Store a complete debate round in the DebateRound table. */
export async function storeDebateRound(round: DebateRoundResult): Promise<string> {
  const record = await prisma.debateRound.create({
    data: {
      pipelineRunId: round.pipelineRunId,
      challengerAgent: round.challengerAgent,
      defenderAgent: round.defenderAgent,
      triggerOpinion: round.triggerOpinion,
      conflictSnippet: round.conflictSnippet,
      outcome: round.outcome,
      turnCount: round.turns.length,
      resolutionNote: round.resolutionNote,
      costUsd: round.costUsd,
      stepIndex: round.stepIndex,
    },
  });
  return record.id;
}

// --- Post-Debate ---

/** Store debate outcome as RAG memory for both agents. */
export async function ingestDebateMemory(
  projectId: string,
  round: DebateRoundResult,
): Promise<void> {
  const significance = {
    accepted: SIGNIFICANCE_DEBATE_ACCEPTED,
    revised: SIGNIFICANCE_DEBATE_REVISED,
    compromise: SIGNIFICANCE_DEBATE_COMPROMISE,
    escalated: SIGNIFICANCE_DEBATE_ESCALATED,
  }[round.outcome] ?? SIGNIFICANCE_DEBATE_ACCEPTED;

  const content = `Debate about "${round.triggerOpinion}". ${round.challengerAgent} challenged ${round.defenderAgent}. Outcome: ${round.outcome}. ${round.resolutionNote ?? ""}`;

  // Store for both agents
  for (const agent of [round.challengerAgent, round.defenderAgent]) {
    await storeMemory({
      projectId,
      agent,
      type: "debate",
      title: `Debate: ${round.challengerAgent} vs ${round.defenderAgent} (${round.outcome})`,
      content,
      sourceType: "event_log",
      sourceId: `debate:${round.debateId}:${agent}`,
      significance,
    }).catch(() => {});
  }
}


/** Adjust trust/tension/rapport based on debate outcome. */
export async function updateDebateRelationships(
  projectId: string,
  round: DebateRoundResult,
): Promise<void> {
  try {
    // Challenger → Defender relationship
    const challengerToDefender = await prisma.agentRelationship.findFirst({
      where: { projectId, fromAgent: round.challengerAgent, toAgent: round.defenderAgent },
    });

    if (challengerToDefender) {
      const updates: Record<string, number | string> = {};

      switch (round.outcome) {
        case "accepted":
          updates.trust = clamp(challengerToDefender.trust + TRUST_BOOST_DEBATE_ACCEPTED, 0, 1);
          updates.tension = clamp(challengerToDefender.tension - TENSION_DROP_DEBATE_CONCEDE, 0, 1);
          updates.lastNote = "Debate: challenge accepted gracefully";
          break;
        case "revised":
          updates.tension = clamp(challengerToDefender.tension + TENSION_RISE_DEBATE_CHALLENGE, 0, 1);
          updates.lastNote = "Debate: work was revised after challenge";
          break;
        case "compromise":
          updates.rapport = clamp(challengerToDefender.rapport + RAPPORT_BOOST_DEBATE_COMPROMISE, 0, 1);
          updates.tension = clamp(challengerToDefender.tension - TENSION_DROP_DEBATE_CONCEDE, 0, 1);
          updates.lastNote = "Debate: reached compromise";
          break;
        case "escalated":
          updates.trust = clamp(challengerToDefender.trust - TRUST_DROP_DEBATE_ESCALATED, 0, 1);
          updates.tension = clamp(challengerToDefender.tension + TENSION_RISE_DEBATE_CHALLENGE, 0, 1);
          updates.lastNote = "Debate: had to escalate to PM";
          break;
      }

      if (Object.keys(updates).length > 0) {
        await prisma.agentRelationship.updateMany({
          where: { projectId, fromAgent: round.challengerAgent, toAgent: round.defenderAgent },
          data: updates,
        });
      }
    }
  } catch {
    // Relationship update is non-fatal
  }
}
