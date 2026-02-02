/**
 * Provider registry — runtime detection of available AI providers.
 * Model constants live in models.ts (client-safe).
 * This file adds runtime detection (server-only).
 */

import { execSync } from "child_process";
import { CLAUDE_MODELS, GEMINI_MODELS } from "./models";

// Re-export model constants so server files can import from one place
export { CLAUDE_MODELS, GEMINI_MODELS, DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL } from "./models";

export interface ProviderCapabilities {
  fileAccess: boolean;
  shellAccess: boolean;
  toolUse: boolean;
  subAgents: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
  models: string[];
  capabilities: ProviderCapabilities;
}

// --- Detectors ---

function detectClaudeCode(): ProviderInfo {
  const info: ProviderInfo = {
    id: "claude-code",
    name: "Claude Code CLI",
    available: false,
    models: [...CLAUDE_MODELS],
    capabilities: {
      fileAccess: true,
      shellAccess: true,
      toolUse: true,
      subAgents: true,
    },
  };

  try {
    execSync("which claude", { encoding: "utf-8", stdio: "pipe" });
    info.available = true;
  } catch {
    info.reason = "Claude Code CLI not found (run: npm install -g @anthropic-ai/claude-code)";
  }

  return info;
}

function detectGemini(): ProviderInfo {
  const info: ProviderInfo = {
    id: "gemini",
    name: "Google Gemini",
    available: false,
    models: [...GEMINI_MODELS],
    capabilities: {
      fileAccess: false,
      shellAccess: false,
      toolUse: false,
      subAgents: false,
    },
  };

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    info.available = true;
  } else {
    info.reason = "GOOGLE_GENERATIVE_AI_API_KEY not set";
  }

  return info;
}

// --- Registry ---

let cachedProviders: ProviderInfo[] | null = null;

export async function scanProviders(): Promise<ProviderInfo[]> {
  const [claude, gemini] = await Promise.all([
    Promise.resolve(detectClaudeCode()),
    Promise.resolve(detectGemini()),
  ]);
  return [claude, gemini];
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

/**
 * Resolve provider id from a model string.
 * Synchronous helper for hot paths (uses cached data or heuristic).
 */
export function resolveProviderId(model: string): string {
  if (model.startsWith("gemini")) return "gemini";
  return "claude-code";
}

// Agents that produce text-only output and can run on prompt-only providers
const PROMPT_ONLY_AGENTS = new Set(["pm"]);

/**
 * Check if an agent can fall back to a given provider.
 * Full-capability providers (file+tool access) can serve any agent.
 * Prompt-only providers (Gemini) can only serve prompt-only agents (PM).
 */
export function canFallbackTo(agentType: string, provider: ProviderInfo): boolean {
  if (provider.capabilities.fileAccess && provider.capabilities.toolUse) return true;
  return PROMPT_ONLY_AGENTS.has(agentType);
}

/**
 * Pick the cheapest available model (for summaries, lightweight tasks).
 * Prefers gemini flash if available, falls back to claude haiku.
 */
export async function getCheapestAvailableModel(): Promise<{ provider: string; model: string }> {
  const providers = await getAvailableProviders();
  const gemini = providers.find((p) => p.id === "gemini" && p.available);
  if (gemini) {
    return { provider: "gemini", model: gemini.models[0] };
  }
  return { provider: "claude-code", model: CLAUDE_MODELS[CLAUDE_MODELS.length - 1] }; // haiku
}
