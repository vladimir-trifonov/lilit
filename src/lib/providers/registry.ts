/**
 * Provider adapter registry — scanning, resolution, and fallback logic.
 */

import { claudeCodeAdapter } from "./claude-code.adapter";
import { geminiAdapter } from "./gemini.adapter";
import { claudeApiAdapter } from "./claude-api.adapter";
import { antigravityAdapter } from "./antigravity.adapter";
import { getAgent } from "../agent-loader";
import { getModelPricing } from "../cost-calculator";
import type { ProviderAdapter, ProviderInfo } from "./types";

// ---- Adapter Registration ----

const adapters: ProviderAdapter[] = [
  claudeCodeAdapter,
  geminiAdapter,
  claudeApiAdapter,
  antigravityAdapter,
];

/** Map from model name to provider id, built from adapter model lists. */
const modelToProvider = new Map<string, string>();
for (const adapter of adapters) {
  for (const model of adapter.models) {
    modelToProvider.set(model, adapter.id);
  }
}

// ---- Public API ----

export function getAdapter(providerId: string): ProviderAdapter {
  const adapter = adapters.find((a) => a.id === providerId);
  if (!adapter) throw new Error(`Unknown provider: ${providerId}`);
  return adapter;
}

/**
 * Resolve provider id from a model string.
 * Uses the explicit model-to-provider map built from adapter registrations.
 */
export function resolveProviderId(model: string): string {
  return modelToProvider.get(model) ?? "claude-code";
}

// ---- Detection & Scanning ----

let cachedProviders: ProviderInfo[] | null = null;

export async function scanProviders(): Promise<ProviderInfo[]> {
  return adapters.map((a) => a.detect());
}

export async function getAvailableProviders(refresh = false): Promise<ProviderInfo[]> {
  if (!cachedProviders || refresh) {
    cachedProviders = await scanProviders();
  }
  return cachedProviders;
}

export async function getProviderForModel(modelId: string): Promise<ProviderInfo | null> {
  const providers = await getAvailableProviders();
  return providers.find((p) => p.models.includes(modelId)) ?? null;
}

// ---- Fallback Logic ----

/**
 * Capabilities that require a full-capability (file-access) provider.
 * If an agent lists any of these, it cannot run on prompt-only providers.
 */
const FULL_CAPABILITY_TAGS = new Set(["file-access", "shell-access"]);

/**
 * Check if an agent can fall back to a given provider.
 * Uses agent capabilities from YAML frontmatter instead of a hardcoded set.
 *
 * - Full-capability providers can serve any agent.
 * - Prompt-only providers can only serve agents whose capabilities
 *   don't include file-access or shell-access.
 */
export function canFallbackTo(agentType: string, provider: ProviderInfo): boolean {
  // Full-capability providers can run anything
  if (provider.capabilities.fileAccess && provider.capabilities.toolUse) return true;

  // Check agent's declared capabilities from frontmatter
  const agent = getAgent(agentType);
  if (!agent) return false;

  const needsFull = agent.capabilities.some((c) => FULL_CAPABILITY_TAGS.has(c));
  return !needsFull;
}

// ---- Cheapest Model Selection ----

/**
 * Pick the cheapest available model (for summaries, lightweight tasks).
 * Iterates all models from available providers and selects by lowest cost.
 */
export async function getCheapestAvailableModel(): Promise<{ provider: string; model: string }> {
  const providers = await getAvailableProviders();
  const available = providers.filter((p) => p.available && p.models.length > 0);

  let best: { provider: string; model: string; cost: number } | null = null;

  for (const p of available) {
    for (const model of p.models) {
      const pricing = getModelPricing(model);
      const cost = pricing.inputPer1M + pricing.outputPer1M;
      if (!best || cost < best.cost) {
        best = { provider: p.id, model, cost };
      }
    }
  }

  if (best) return { provider: best.provider, model: best.model };

  // Fallback — should not happen if at least one provider is configured
  const fallback = adapters[0];
  return { provider: fallback.id, model: fallback.models[0] };
}
