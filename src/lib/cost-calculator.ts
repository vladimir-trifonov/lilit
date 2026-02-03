/**
 * Cost calculation for AI model usage
 * Pricing can be configured via environment variables
 */

import { TOKENS_PER_MILLION, COST_DISPLAY_PRECISION_THRESHOLD } from "@/lib/constants";

interface ModelPricing {
  inputPer1M: number; // USD per 1M input tokens
  outputPer1M: number; // USD per 1M output tokens
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
  // Antigravity models are free (Google quota) — no entries needed.
  // getModelPricing() returns zero for any model not listed here.
};

/**
 * Get pricing for a model (from env or defaults)
 */
export function getModelPricing(model: string): ModelPricing {
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

  const inputCost = (usage.inputTokens / TOKENS_PER_MILLION) * pricing.inputPer1M;
  const outputCost = (usage.outputTokens / TOKENS_PER_MILLION) * pricing.outputPer1M;

  return inputCost + outputCost;
}

/**
 * Format cost as USD string
 */
export function formatCost(costUsd: number): string {
  if (costUsd === 0) return "Free";
  if (costUsd < COST_DISPLAY_PRECISION_THRESHOLD) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

