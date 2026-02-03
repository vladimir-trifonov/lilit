/**
 * Ollama embedding client.
 * Uses nomic-embed-text (768 dimensions) for vector embeddings.
 * Gracefully degrades — returns null when Ollama is unavailable.
 */

import {
  DEFAULT_OLLAMA_URL,
  EMBED_MODEL,
  EMBEDDING_TIMEOUT_MS,
  MODEL_PULL_TIMEOUT_MS,
  OLLAMA_HEALTH_CHECK_TIMEOUT_MS,
} from "@/lib/constants";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;

let modelReady: boolean | null = null;

/**
 * Check if the embedding model is available, pull if needed.
 * Result is cached — only checks once per process.
 */
async function ensureModel(): Promise<boolean> {
  if (modelReady !== null) return modelReady;

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_HEALTH_CHECK_TIMEOUT_MS),
    });
    if (!res.ok) {
      modelReady = false;
      return false;
    }

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    const found = models.some(
      (m) => m.name === EMBED_MODEL || m.name.startsWith(`${EMBED_MODEL}:`)
    );

    if (!found) {
      // Pull the model
      const pullRes = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: EMBED_MODEL }),
        signal: AbortSignal.timeout(MODEL_PULL_TIMEOUT_MS),
      });
      if (!pullRes.ok) {
        modelReady = false;
        return false;
      }
      // Consume stream to completion
      const reader = pullRes.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    }

    modelReady = true;
    return true;
  } catch {
    modelReady = false;
    return false;
  }
}

/**
 * Generate an embedding vector for a single text.
 * Returns null if Ollama is unavailable.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const ready = await ensureModel();
  if (!ready) return null;

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Generate embeddings for multiple texts (sequential — Ollama is single-threaded).
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}

/**
 * Check if Ollama embedding service is reachable.
 */
export async function isEmbeddingServiceAvailable(): Promise<boolean> {
  return ensureModel();
}

/**
 * Reset cached model readiness (for testing or reconnection).
 */
export function resetEmbeddingCache(): void {
  modelReady = null;
}

