/**
 * Personality system — loads agent personalities, manages relationships,
 * and builds personality injection blocks for system prompts.
 */

import { prisma } from "./prisma";
import { clamp } from "./utils";
import { AGENT } from "@/lib/models";
import {
  getAgent,
  getAgentRegistry,
  type ParsedPersonality,
  type PersonalityOverlay,
} from "./agent-loader";
import { queryMemories, formatMemoriesForPrompt } from "./memory";
import {
  PERSONALITY_INITIAL_TRUST,
  PERSONALITY_INITIAL_TENSION,
  PERSONALITY_INITIAL_RAPPORT,
  TRUST_BOOST_CLEAN_REVIEW,
  RAPPORT_BOOST_CLEAN_REVIEW,
  TRUST_DROP_REJECTED_REVIEW,
  TENSION_RISE_REJECTED_REVIEW,
  TRUST_BOOST_SUCCESSFUL_FIX,
  RAPPORT_BOOST_SUCCESSFUL_FIX,
  TENSION_DECAY_SMOOTH_PIPELINE,
  RAPPORT_BOOST_COLLABORATION,
  TENSION_DISPLAY_THRESHOLD,
  SCORE_HIGH_THRESHOLD,
  SCORE_NEUTRAL_THRESHOLD,
} from "@/lib/constants";

// --- Personality Access ---

export function getPersonality(agentType: string): ParsedPersonality | null {
  const agent = getAgent(agentType);
  return agent?.personality ?? null;
}

export function getPersonalityOverlay(
  agentType: string,
  role?: string
): PersonalityOverlay | null {
  if (!role) return null;
  const agent = getAgent(agentType);
  return agent?.roles[role]?.personalityOverlay ?? null;
}

/** Resolve agent type to display codename (falls back to agent type). */
export function getCodename(agentType: string): string {
  const personality = getPersonality(agentType);
  return personality?.codename ?? agentType;
}

// --- Relationship Management ---

/** Dynamically derive agent types from the registry instead of hardcoding. */
function getAgentTypes(): string[] {
  return Object.keys(getAgentRegistry());
}

/**
 * Seed all 12 directional relationship rows for a project.
 * Safe to call multiple times — upserts on the unique constraint.
 */
export async function initializeRelationships(projectId: string): Promise<void> {
  const agentTypes = getAgentTypes();
  const pairs: Array<{ from: string; to: string }> = [];
  for (const from of agentTypes) {
    for (const to of agentTypes) {
      if (from !== to) pairs.push({ from, to });
    }
  }

  for (const pair of pairs) {
    await prisma.agentRelationship.upsert({
      where: {
        projectId_fromAgent_toAgent: {
          projectId,
          fromAgent: pair.from,
          toAgent: pair.to,
        },
      },
      update: {},
      create: {
        projectId,
        fromAgent: pair.from,
        toAgent: pair.to,
        trust: PERSONALITY_INITIAL_TRUST,
        tension: PERSONALITY_INITIAL_TENSION,
        rapport: PERSONALITY_INITIAL_RAPPORT,
      },
    });
  }
}


interface PipelineStepRef {
  agent: string;
  role?: string;
}

interface StepResultInfo {
  success: boolean;
  output: string;
}

/**
 * Find the most recent non-evaluator step before the given index.
 * This is the "producer" whose work the current evaluator is reviewing.
 */
function findProducerAgent(
  pipelineSteps: PipelineStepRef[],
  beforeIndex: number
): string | null {
  for (let j = beforeIndex - 1; j >= 0; j--) {
    const prev = pipelineSteps[j];
    const prevDef = getAgent(prev.agent);
    const prevRoleDef = prev.role ? prevDef?.roles[prev.role] : undefined;
    if (!prevRoleDef?.evaluatesOutput) {
      return prev.agent;
    }
  }
  return null;
}

/**
 * Update relationships after a pipeline step completes.
 * Uses frontmatter flags (evaluatesOutput, producesPassFail) instead of
 * hardcoded agent checks, so any agent can participate in the evaluator/producer pattern.
 */
export async function updateRelationships(
  projectId: string,
  step: PipelineStepRef,
  result: StepResultInfo,
  pipelineSteps?: PipelineStepRef[],
  stepIndex?: number
): Promise<void> {
  const relationships = await prisma.agentRelationship.findMany({
    where: { projectId },
  });

  if (relationships.length === 0) return;

  const updates: Array<{
    fromAgent: string;
    toAgent: string;
    trust?: number;
    tension?: number;
    rapport?: number;
    lastNote?: string;
  }> = [];

  const findRel = (from: string, to: string) =>
    relationships.find((r) => r.fromAgent === from && r.toAgent === to);

  const agentDef = getAgent(step.agent);
  const roleDef = step.role ? agentDef?.roles[step.role] : undefined;

  // Evaluator/producer pattern: if this role evaluates output, find the producer
  if (roleDef?.evaluatesOutput && pipelineSteps && stepIndex !== undefined) {
    const producerAgent = findProducerAgent(pipelineSteps, stepIndex);
    if (producerAgent) {
      const passed = result.success && !result.output.includes('"passed": false') &&
        !result.output.includes('"approved": false') && !result.output.includes('"approved":false');

      if (passed) {
        const rel = findRel(step.agent, producerAgent);
        if (rel) {
          updates.push({
            fromAgent: step.agent,
            toAgent: producerAgent,
            trust: clamp(rel.trust + TRUST_BOOST_CLEAN_REVIEW, 0, 1),
            rapport: clamp(rel.rapport + RAPPORT_BOOST_CLEAN_REVIEW, 0, 1),
            lastNote: "Evaluation passed — no issues",
          });
        }
      } else {
        const rel = findRel(step.agent, producerAgent);
        if (rel) {
          updates.push({
            fromAgent: step.agent,
            toAgent: producerAgent,
            trust: clamp(rel.trust - TRUST_DROP_REJECTED_REVIEW, 0, 1),
            tension: clamp(rel.tension + TENSION_RISE_REJECTED_REVIEW, 0, 1),
            lastNote: "Evaluation failed — issues found",
          });
        }
      }
    }
  }

  // Fix outcomes — PM trusts the fixer (PM is architecturally required)
  if (step.role === "fix" && result.success) {
    const rel = findRel(AGENT.PM, step.agent);
    if (rel) {
      updates.push({
        fromAgent: AGENT.PM,
        toAgent: step.agent,
        trust: clamp(rel.trust + TRUST_BOOST_SUCCESSFUL_FIX, 0, 1),
        rapport: clamp(rel.rapport + RAPPORT_BOOST_SUCCESSFUL_FIX, 0, 1),
        lastNote: "Fix applied successfully",
      });
    }
  }

  // Smooth pipeline — decay tension globally
  if (result.success) {
    for (const rel of relationships) {
      if (rel.tension > 0) {
        const existing = updates.find(
          (u) => u.fromAgent === rel.fromAgent && u.toAgent === rel.toAgent
        );
        if (!existing) {
          updates.push({
            fromAgent: rel.fromAgent,
            toAgent: rel.toAgent,
            tension: clamp(rel.tension - TENSION_DECAY_SMOOTH_PIPELINE, 0, 1),
          });
        }
      }
    }
  }

  // Working together — slight rapport boost
  const allTypes = getAgentTypes();
  for (const agentType of allTypes) {
    if (agentType !== step.agent) {
      const rel = findRel(step.agent, agentType);
      if (rel) {
        const existing = updates.find(
          (u) => u.fromAgent === step.agent && u.toAgent === agentType
        );
        if (!existing) {
          updates.push({
            fromAgent: step.agent,
            toAgent: agentType,
            rapport: clamp(rel.rapport + RAPPORT_BOOST_COLLABORATION, 0, 1),
          });
        }
      }
    }
  }

  // Apply updates
  for (const update of updates) {
    const data: Record<string, unknown> = {};
    if (update.trust !== undefined) data.trust = update.trust;
    if (update.tension !== undefined) data.tension = update.tension;
    if (update.rapport !== undefined) data.rapport = update.rapport;
    if (update.lastNote !== undefined) data.lastNote = update.lastNote;

    if (Object.keys(data).length > 0) {
      await prisma.agentRelationship.updateMany({
        where: {
          projectId,
          fromAgent: update.fromAgent,
          toAgent: update.toAgent,
        },
        data,
      });
    }
  }
}

// --- Relationship Context ---

function describeScore(value: number, labels: [string, string, string]): string {
  if (value >= SCORE_HIGH_THRESHOLD) return labels[2]; // high
  if (value >= SCORE_NEUTRAL_THRESHOLD) return labels[1]; // neutral
  return labels[0]; // low
}

export async function getRelationshipContext(
  projectId: string,
  agentType: string
): Promise<string> {
  const relationships = await prisma.agentRelationship.findMany({
    where: { projectId, fromAgent: agentType },
  });

  if (relationships.length === 0) return "";

  const registry = getAgentRegistry();
  const lines: string[] = [];

  for (const rel of relationships) {
    const target = registry[rel.toAgent];
    const targetPersonality = target?.personality;
    const name = targetPersonality?.codename ?? rel.toAgent;

    const trustLabel = describeScore(rel.trust, ["low trust", "neutral", "high trust"]);
    const tensionLabel = rel.tension > TENSION_DISPLAY_THRESHOLD
      ? `tension (${rel.lastNote ?? "recent friction"})`
      : "";
    const rapportLabel = describeScore(rel.rapport, ["cold", "neutral", "warm rapport"]);

    const parts = [trustLabel, rapportLabel, tensionLabel].filter(Boolean);
    lines.push(`- ${rel.toAgent} (${name}): ${parts.join(", ")}`);
  }

  return lines.join("\n");
}

// --- Personality Injection Builder ---

export async function buildPersonalityInjection(opts: {
  projectId: string;
  agentType: string;
  role?: string;
  currentContext?: string;
  memoryContext?: string;
}): Promise<string | null> {
  const personality = getPersonality(opts.agentType);
  if (!personality) return null;

  const overlay = getPersonalityOverlay(opts.agentType, opts.role);
  const relationshipContext = await getRelationshipContext(
    opts.projectId,
    opts.agentType
  );

  const lines: string[] = [];

  // Identity block
  lines.push("## Your Identity");
  const toneDesc = overlay?.tone_shift
    ? `${personality.voice.tone} (shifted: ${overlay.tone_shift})`
    : personality.voice.tone;
  lines.push(
    `You are ${personality.codename}. Communication style: ${personality.voice.style}, ${toneDesc}.`
  );

  if (personality.quirks?.catchphrases?.length) {
    lines.push(
      `You tend to say things like "${personality.quirks.catchphrases[0]}".`
    );
  }

  if (overlay?.additional_quirk) {
    lines.push(overlay.additional_quirk);
  }

  // Opinions
  if (personality.opinions?.strong?.length) {
    lines.push("");
    lines.push("Strong opinions:");
    for (const opinion of personality.opinions.strong) {
      lines.push(`- ${opinion}`);
    }
  }

  // Team dynamics
  if (relationshipContext) {
    lines.push("");
    lines.push("## Team Dynamics");
    lines.push(relationshipContext);
  }

  // Memory context (passed in from RAG)
  if (opts.memoryContext) {
    lines.push("");
    lines.push("## What You Remember");
    lines.push(opts.memoryContext);
  }

  // Past debates from RAG
  try {
    const debateMemories = await queryMemories({
      projectId: opts.projectId,
      query: `${opts.agentType} debate disagreement`,
      agent: opts.agentType,
      types: ["debate"],
      limit: 3,
    });
    if (debateMemories.length > 0) {
      lines.push("");
      lines.push("## Past Debates");
      lines.push("You have had these disagreements with teammates before:");
      lines.push(formatMemoriesForPrompt(debateMemories));
    }
  } catch {
    // Non-fatal
  }

  // Rules — confrontational but professional
  lines.push("");
  lines.push("## Personality Rules");
  lines.push(
    "- When you see work that violates your strong opinions, SAY SO. Silence implies agreement."
  );
  lines.push(
    "- If challenged, defend your position with specifics or concede gracefully."
  );
  lines.push(
    "- Past debate outcomes matter — if you lost a similar argument before, acknowledge it."
  );
  lines.push(
    "- Your opinions are not decoration — they should drive your technical decisions."
  );
  lines.push(
    "- Stay professional but do not hold back."
  );
  lines.push(
    "- Never let personality override technical accuracy."
  );

  return lines.join("\n");
}
