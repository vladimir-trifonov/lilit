/**
 * Memory store — RAG-powered memory for agents.
 * Uses pgvector for cosine similarity search and Ollama for embeddings.
 */

import { prisma } from "./prisma";
import { generateEmbedding } from "./embeddings";
import { RAG_MEMORY_LIMIT, RAG_MIN_SIMILARITY } from "@/lib/constants";

// --- Types ---

export interface MemoryInput {
  projectId: string;
  agent?: string;
  role?: string;
  type: "code_pattern" | "decision" | "personality" | "debate";
  title: string;
  content: string;
  sourceType: "event_log" | "agent_run" | "manual" | "file_index";
  sourceId?: string;
  significance?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  agent: string | null;
  role: string | null;
  type: string;
  title: string;
  content: string;
  significance: number;
  createdAt: Date;
  similarity?: number;
}

// --- Store ---

/**
 * Store a memory record. Deduplicates by sourceType + sourceId.
 * Generates embedding via Ollama and stores the vector via raw SQL.
 */
export async function storeMemory(input: MemoryInput): Promise<string | null> {
  // Dedup check
  if (input.sourceId) {
    const existing = await prisma.memory.findFirst({
      where: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    if (existing) return existing.id;
  }

  const record = await prisma.memory.create({
    data: {
      projectId: input.projectId,
      agent: input.agent,
      role: input.role,
      type: input.type,
      title: input.title,
      content: input.content,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      significance: input.significance ?? 0.5,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });

  // Generate and store embedding (fire-and-forget pattern if desired by caller)
  const embedding = await generateEmbedding(`${input.title}\n${input.content}`);
  if (embedding && embedding.every((v) => Number.isFinite(v))) {
    const vectorStr = `[${embedding.join(",")}]`;
    await prisma.$queryRawUnsafe(
      `UPDATE "Memory" SET "embedding" = $1::vector WHERE "id" = $2`,
      vectorStr,
      record.id
    );
  }

  return record.id;
}

// --- Retrieval ---

export interface QueryMemoriesOpts {
  projectId: string;
  query: string;
  agent?: string;
  types?: string[];
  limit?: number;
  minSimilarity?: number;
}

/**
 * Query memories using cosine similarity search.
 * Falls back to recency-based retrieval when embeddings are unavailable.
 */
export async function queryMemories(
  opts: QueryMemoriesOpts
): Promise<MemoryRecord[]> {
  const {
    projectId,
    query,
    agent,
    types,
    limit = RAG_MEMORY_LIMIT,
    minSimilarity = RAG_MIN_SIMILARITY,
  } = opts;

  // Try vector search first
  const queryEmbedding = await generateEmbedding(query);

  if (queryEmbedding && queryEmbedding.every((v) => Number.isFinite(v))) {
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    // Build WHERE conditions
    const conditions: string[] = [
      `m."projectId" = $1`,
      `m."embedding" IS NOT NULL`,
      `1 - (m."embedding" <=> $2::vector) >= $3`,
    ];
    const params: unknown[] = [projectId, vectorStr, minSimilarity];
    let paramIdx = 4;

    // Agent filter: match specific agent or shared memories (agent IS NULL)
    if (agent) {
      conditions.push(`(m."agent" = $${paramIdx} OR m."agent" IS NULL)`);
      params.push(agent);
      paramIdx++;
    }

    if (types && types.length > 0) {
      const placeholders = types.map((_, i) => `$${paramIdx + i}`).join(", ");
      conditions.push(`m."type" IN (${placeholders})`);
      params.push(...types);
      paramIdx += types.length;
    }

    const whereClause = conditions.join(" AND ");

    const results = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        projectId: string;
        agent: string | null;
        role: string | null;
        type: string;
        title: string;
        content: string;
        significance: number;
        createdAt: Date;
        similarity: number;
      }>
    >(
      `SELECT m."id", m."projectId", m."agent", m."role", m."type", m."title",
              m."content", m."significance", m."createdAt",
              1 - (m."embedding" <=> $2::vector) AS similarity
       FROM "Memory" m
       WHERE ${whereClause}
       ORDER BY similarity DESC
       LIMIT $${paramIdx}`,
      ...params,
      limit
    );

    return results;
  }

  // Fallback: recency-based retrieval (no embeddings available)
  const where: Record<string, unknown> = { projectId };
  if (agent) {
    where.OR = [{ agent }, { agent: null }];
  }
  if (types && types.length > 0) {
    where.type = { in: types };
  }

  const results = await prisma.memory.findMany({
    where,
    orderBy: [{ significance: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return results;
}

// --- Prompt Formatter ---

const TYPE_LABELS: Record<string, string> = {
  code_pattern: "Code Patterns",
  decision: "Past Decisions",
  personality: "Team Context",
  debate: "Past Debates",
};

/**
 * Format retrieved memories into a markdown section for injection into prompts.
 */
export function formatMemoriesForPrompt(memories: MemoryRecord[]): string {
  if (memories.length === 0) return "";

  // Group by type
  const grouped: Record<string, MemoryRecord[]> = {};
  for (const mem of memories) {
    const key = mem.type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(mem);
  }

  const sections: string[] = [];
  for (const [type, mems] of Object.entries(grouped)) {
    const label = TYPE_LABELS[type] ?? type;
    const items = mems.map((m) => `- ${m.title}: ${m.content}`).join("\n");
    sections.push(`**${label}**\n${items}`);
  }

  return sections.join("\n\n");
}

/**
 * Get recommended memory types for a given agent/role combination.
 * All agents get the full set of memory types including debate context.
 */
export function getMemoryTypesForAgent(): string[] {
  return ["decision", "code_pattern", "personality", "debate"];
}
