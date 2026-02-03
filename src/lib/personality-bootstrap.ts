/**
 * Personality bootstrap — agents define their own personality on first project interaction.
 * AGENT.md provides role/capabilities; personality emerges from the agent itself.
 * Stored in RAG as "personality" type memories with high significance.
 */

import { getAgent, type ParsedPersonality } from "./agent-loader";
import { getAdapter, getCheapestAvailableModel } from "./providers/index";
import { storeMemory, queryMemories } from "./memory";
import { extractJSON } from "./utils";
import {
  PERSONALITY_BOOTSTRAP_MAX_TOKENS,
  PERSONALITY_MEMORY_SIGNIFICANCE,
} from "@/lib/constants";

// --- Types ---

export interface BootstrappedPersonality extends ParsedPersonality {
  bootstrappedAt: string;
}

// --- Bootstrap ---

/**
 * Run an LLM call asking the agent to define its personality.
 * Uses the cheapest available model.
 */
export async function bootstrapPersonality(
  projectId: string,
  agentType: string,
): Promise<BootstrappedPersonality | null> {
  const agent = getAgent(agentType);
  if (!agent) return null;

  const seed = agent.personalitySeed ?? "";
  const seedLine = seed ? `\nHere is a seed hint for your personality (use it as inspiration, not as a constraint): "${seed}"\n` : "";

  const prompt = `You are being assigned the role of ${agentType} on a software development team.

Here is your role description:
${agent.systemPrompt.slice(0, 2000)}
${seedLine}
Define your personality. Be specific and opinionated. Real people have strong views.
You are a unique individual with preferences, pet peeves, and a distinctive way of communicating.

Output ONLY valid JSON matching this exact schema:
{
  "codename": "your chosen first name (single word, human name)",
  "voice": {
    "style": "one or two words describing your communication style",
    "tone": "one or two words describing your default tone",
    "tempo": "one word: fast, measured, or deliberate"
  },
  "opinions": {
    "strong": ["3-5 strong technical opinions you hold"],
    "dislikes": ["3-5 things you dislike in software development"]
  },
  "quirks": {
    "catchphrases": ["2-3 things you tend to say"],
    "pet_peeves": ["2-3 things that particularly annoy you"],
    "habits": ["2-3 behavioral habits"]
  },
  "strengths": ["3-4 strengths"],
  "weaknesses": ["2-3 weaknesses that create realistic friction"]
}`;

  try {
    const { provider, model } = await getCheapestAvailableModel();
    const adapter = getAdapter(provider);

    const result = await adapter.execute({
      prompt,
      systemPrompt: "You are defining your own personality as an AI agent on a software team. Be creative, specific, and opinionated. Output ONLY valid JSON.",
      model,
      maxTokens: PERSONALITY_BOOTSTRAP_MAX_TOKENS,
      agentLabel: `bootstrap:${agentType}`,
    });

    const parsed = parseBootstrapJSON(result.output);
    if (!parsed) return null;

    return {
      ...parsed,
      bootstrappedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Check RAG for existing personality, bootstrap if not found.
 */
export async function getOrBootstrapPersonality(
  projectId: string,
  agentType: string,
): Promise<ParsedPersonality | null> {
  // Check RAG for existing personality memory
  try {
    const memories = await queryMemories({
      projectId,
      query: `${agentType} personality definition`,
      agent: agentType,
      types: ["personality"],
      limit: 1,
    });

    if (memories.length > 0) {
      const stored = parsePersonalityFromMemory(memories[0].content);
      if (stored) return stored;
    }
  } catch {
    // RAG failure — try bootstrap
  }

  // Fall back to AGENT.md frontmatter
  const agent = getAgent(agentType);
  if (agent?.personality) return agent.personality;

  // Bootstrap a new personality
  const bootstrapped = await bootstrapPersonality(projectId, agentType);
  if (!bootstrapped) return null;

  // Store in RAG for future use
  try {
    await storeMemory({
      projectId,
      agent: agentType,
      type: "personality",
      title: `${agentType} personality: ${bootstrapped.codename}`,
      content: JSON.stringify(bootstrapped),
      sourceType: "manual",
      sourceId: `personality:${agentType}:${projectId}`,
      significance: PERSONALITY_MEMORY_SIGNIFICANCE,
    });
  } catch {
    // Storage failure is non-fatal — personality still usable this run
  }

  return bootstrapped;
}

/**
 * After a debate or significant event, agent can propose a personality evolution.
 * Stored as new personality memory with higher significance to replace old one.
 */
export async function evolvePersonality(
  projectId: string,
  agentType: string,
  experience: string,
): Promise<void> {
  const current = await getOrBootstrapPersonality(projectId, agentType);
  if (!current) return;

  try {
    const { provider, model } = await getCheapestAvailableModel();
    const adapter = getAdapter(provider);

    const prompt = `You are ${current.codename} (${agentType}). Here is your current personality:
${JSON.stringify(current, null, 2)}

You just had this experience:
${experience}

Based on this experience, should your personality evolve? If yes, output an updated personality JSON.
If no meaningful change, output exactly: {"no_change": true}

Output ONLY valid JSON.`;

    const result = await adapter.execute({
      prompt,
      systemPrompt: "You are reflecting on an experience and deciding if your personality should evolve. Be thoughtful. Output ONLY valid JSON.",
      model,
      maxTokens: PERSONALITY_BOOTSTRAP_MAX_TOKENS,
      agentLabel: `evolve:${agentType}`,
    });

    const parsed = parseBootstrapJSON(result.output);
    if (!parsed) return; // No change or parse failure

    await storeMemory({
      projectId,
      agent: agentType,
      type: "personality",
      title: `${agentType} personality evolved: ${parsed.codename}`,
      content: JSON.stringify(parsed),
      sourceType: "manual",
      sourceId: `personality:${agentType}:${projectId}:${Date.now()}`,
      significance: PERSONALITY_MEMORY_SIGNIFICANCE,
    });
  } catch {
    // Evolution failure is non-fatal
  }
}

/**
 * Ensure all participating agents have personalities bootstrapped.
 * Runs in parallel for all agents.
 */
export async function ensurePersonalities(
  projectId: string,
  agentTypes: string[],
): Promise<void> {
  await Promise.all(
    agentTypes.map((type) => getOrBootstrapPersonality(projectId, type).catch(() => null))
  );
}

// --- Helpers ---

function parseBootstrapJSON(raw: string): ParsedPersonality | null {
  const parsed = extractJSON(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.no_change) return null;
  if (obj.codename && obj.voice) return obj as unknown as ParsedPersonality;
  return null;
}

function parsePersonalityFromMemory(content: string): ParsedPersonality | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.codename && parsed.voice) return parsed;
  } catch {
    // Not valid JSON personality
  }
  return null;
}
