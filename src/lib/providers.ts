/**
 * Provider registry — runtime detection of available AI providers.
 * Replaces hardcoded Provider type with dynamic scanning.
 */

import { execSync } from "child_process";

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
    models: ["sonnet", "opus", "haiku"],
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
    models: [
      "gemini-2.5-flash",
      "gemini-3-pro-preview",
      "gemini-3-pro-high",
      "gemini-3-pro-low",
    ],
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
