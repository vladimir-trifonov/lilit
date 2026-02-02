/**
 * Cost calculation for AI model usage
 * Pricing can be configured via environment variables
 */

interface ModelPricing {
  inputPer1M: number; // USD per 1M input tokens
  outputPer1M: number; // USD per 1M output tokens
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// Dynamic pricing registry (populated at runtime)
const customPricing: Record<string, ModelPricing> = {};

/**
 * Register pricing for a model at runtime (e.g. from provider scanning)
 */
export function registerModelPricing(model: string, pricing: ModelPricing) {
  customPricing[model.toLowerCase()] = pricing;
}

// Default pricing (as of Feb 2026) - can be overridden via env vars
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Claude models (via API - subscription is free via CLI)
  "claude-opus-4-5": {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
  },
  "claude-sonnet-4-5": {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
  },
  "claude-sonnet-4": {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
  },
  sonnet: {
    // Claude Code CLI alias - FREE via subscription
    inputPer1M: 0.0,
    outputPer1M: 0.0,
  },
  opus: {
    // Claude Code CLI alias - FREE via subscription
    inputPer1M: 0.0,
    outputPer1M: 0.0,
  },
  haiku: {
    // Claude Code CLI alias - FREE via subscription
    inputPer1M: 0.0,
    outputPer1M: 0.0,
  },
  // Google Gemini models (free tier available)
  "gemini-2.5-flash": {
    inputPer1M: 0.0, // Free tier
    outputPer1M: 0.0,
  },
  "gemini-3-pro-preview": {
    inputPer1M: 0.0, // Free tier
    outputPer1M: 0.0,
  },
  "gemini-3-pro-high": {
    inputPer1M: 0.075,
    outputPer1M: 0.30,
  },
  "gemini-3-pro-low": {
    inputPer1M: 0.0375,
    outputPer1M: 0.15,
  },
};

/**
 * Get pricing for a model (from env or defaults)
 */
function getModelPricing(model: string): ModelPricing {
  const modelKey = model.toLowerCase();

  // Check for env var overrides first
  const inputKey = `PRICING_${modelKey.replace(/[^a-z0-9]/g, "_").toUpperCase()}_INPUT`;
  const outputKey = `PRICING_${modelKey.replace(/[^a-z0-9]/g, "_").toUpperCase()}_OUTPUT`;

  const envInput = process.env[inputKey];
  const envOutput = process.env[outputKey];

  if (envInput && envOutput) {
    return {
      inputPer1M: parseFloat(envInput),
      outputPer1M: parseFloat(envOutput),
    };
  }

  // Check runtime-registered pricing
  if (customPricing[modelKey]) {
    return customPricing[modelKey];
  }

  // Return default pricing or zero if unknown
  return (
    DEFAULT_PRICING[modelKey] || {
      inputPer1M: 0.0,
      outputPer1M: 0.0,
    }
  );
}

/**
 * Calculate cost in USD for a model usage
 */
export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = getModelPricing(model);

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;

  return inputCost + outputCost;
}

/**
 * Format cost as USD string
 */
export function formatCost(costUsd: number): string {
  if (costUsd === 0) return "Free";
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Parse token usage from Claude Code CLI output
 * Looks for patterns like "8192in/1024out tokens"
 */
export function parseClaudeTokenUsage(output: string): TokenUsage | null {
  const match = output.match(/(\d+)in\/(\d+)out/);
  if (!match) return null;

  return {
    inputTokens: parseInt(match[1]),
    outputTokens: parseInt(match[2]),
  };
}

/**
 * Parse token usage from Gemini response (ai-sdk format)
 */
export function parseGeminiTokenUsage(usage: unknown): TokenUsage | null {
  const u = usage as Record<string, number> | undefined;
  if (!u) return null;

  return {
    inputTokens: u.promptTokens ?? u.inputTokens ?? 0,
    outputTokens: u.completionTokens ?? u.outputTokens ?? 0,
  };
}

/**
 * Get model display name
 */
export function getModelDisplayName(model: string): string {
  const names: Record<string, string> = {
    sonnet: "Claude Sonnet 4.5",
    opus: "Claude Opus 4.5",
    haiku: "Claude Haiku 4",
    "claude-sonnet-4-5": "Claude Sonnet 4.5",
    "claude-opus-4-5": "Claude Opus 4.5",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-3-pro-preview": "Gemini 3 Pro",
    "gemini-3-pro-high": "Gemini 3 Pro High",
    "gemini-3-pro-low": "Gemini 3 Pro Low",
  };
  return names[model.toLowerCase()] || model;
}
