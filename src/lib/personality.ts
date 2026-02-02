/**
 * Personality system — loads agent personalities, manages relationships,
 * and builds personality injection blocks for system prompts.
 */

import { prisma } from "./prisma";
import {
  getAgent,
  getAgentRegistry,
  type ParsedPersonality,
  type PersonalityOverlay,
} from "./agent-loader";

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

// --- Relationship Management ---

const AGENT_TYPES = ["pm", "architect", "developer", "qa"];

/**
 * Seed all 12 directional relationship rows for a project.
 * Safe to call multiple times — upserts on the unique constraint.
 */
export async function initializeRelationships(projectId: string): Promise<void> {
  const pairs: Array<{ from: string; to: string }> = [];
  for (const from of AGENT_TYPES) {
    for (const to of AGENT_TYPES) {
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
        trust: 0.5,
        tension: 0.0,
        rapport: 0.5,
      },
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface StepInfo {
  agent: string;
  role?: string;
}

interface StepResultInfo {
  success: boolean;
  output: string;
}

/**
 * Update relationships after a pipeline step completes.
 * Applies trust/tension/rapport adjustments based on step outcome.
 */
export async function updateRelationships(
  projectId: string,
  step: StepInfo,
  result: StepResultInfo
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

  // Review outcomes
  if (step.role === "review") {
    const approved = result.output.includes('"approved": true') ||
      result.output.includes('"approved":true');
    const rejected = result.output.includes('"approved": false') ||
      result.output.includes('"approved":false');

    if (approved) {
      // Reviewer trusts developer more
      const rel = findRel(step.agent, "developer");
      if (rel) {
        updates.push({
          fromAgent: step.agent,
          toAgent: "developer",
          trust: clamp(rel.trust + 0.05, 0, 1),
          rapport: clamp(rel.rapport + 0.01, 0, 1),
          lastNote: "Clean review — no issues",
        });
      }
    } else if (rejected) {
      const rel = findRel(step.agent, "developer");
      if (rel) {
        updates.push({
          fromAgent: step.agent,
          toAgent: "developer",
          trust: clamp(rel.trust - 0.08, 0, 1),
          tension: clamp(rel.tension + 0.10, 0, 1),
          lastNote: "Review rejected — issues found",
        });
      }
    }
  }

  // QA outcomes
  if (step.agent === "qa") {
    if (result.success && !result.output.includes('"passed": false')) {
      const rel = findRel("qa", "developer");
      if (rel) {
        updates.push({
          fromAgent: "qa",
          toAgent: "developer",
          trust: clamp(rel.trust + 0.05, 0, 1),
          rapport: clamp(rel.rapport + 0.01, 0, 1),
          lastNote: "All tests passing",
        });
      }
    } else {
      const rel = findRel("qa", "developer");
      if (rel) {
        updates.push({
          fromAgent: "qa",
          toAgent: "developer",
          trust: clamp(rel.trust - 0.05, 0, 1),
          tension: clamp(rel.tension + 0.08, 0, 1),
          lastNote: "Test failures detected",
        });
      }
    }
  }

  // Fix outcomes
  if (step.role === "fix") {
    if (result.success) {
      const rel = findRel("pm", "developer");
      if (rel) {
        updates.push({
          fromAgent: "pm",
          toAgent: "developer",
          trust: clamp(rel.trust + 0.03, 0, 1),
          rapport: clamp(rel.rapport + 0.01, 0, 1),
          lastNote: "Fix applied successfully",
        });
      }
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
            tension: clamp(rel.tension - 0.02, 0, 1),
          });
        }
      }
    }
  }

  // Working together — slight rapport boost
  for (const agentType of AGENT_TYPES) {
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
            rapport: clamp(rel.rapport + 0.01, 0, 1),
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
  if (value >= 0.7) return labels[2]; // high
  if (value >= 0.4) return labels[1]; // neutral
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
    const tensionLabel = rel.tension > 0.3
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

  // Rules
  lines.push("");
  lines.push("## Personality Rules");
  lines.push(
    "- Stay in character but never let personality override technical accuracy."
  );
  lines.push("- Reference memories naturally, not as a list.");
  lines.push(
    "- Keep personality subtle — it flavors your output, it does not dominate it."
  );

  return lines.join("\n");
}
