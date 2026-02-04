/**
 * Model and agent constants — single source of truth.
 * Safe for both client and server imports (no Node.js-only deps).
 * All files that need model/agent names should import from here.
 */

// ---- Agent Types ----

/** Core agent type identifiers. PM is required; others are discovered from agents/ directory. */
export const AGENT = {
  PM: "pm",
  ARCHITECT: "architect",
  DEVELOPER: "developer",
  QA: "qa",
} as const;

/** The PM agent is architecturally required — the orchestrator cannot function without it. */
export const REQUIRED_AGENTS: string[] = [AGENT.PM];

// ---- Model Names ----

export const CLAUDE_MODELS = ["sonnet", "opus", "haiku"] as const;
export const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-pro-preview",
  "gemini-3-pro-high",
  "gemini-3-pro-low",
] as const;

export const CLAUDE_API_MODELS = [
  "claude-sonnet-4-5-20250514",
  "claude-sonnet-4-20250514",
  "claude-haiku-3-5-20241022",
] as const;

export const ANTIGRAVITY_MODELS = [
  "antigravity-gemini-3-pro",
  "antigravity-gemini-3-flash",
  "antigravity-claude-sonnet-4-5",
  "antigravity-claude-opus-4-5-thinking",
] as const;

/** Default model per provider (first in list) */
export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODELS[0];
export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0];
export const DEFAULT_CLAUDE_API_MODEL = CLAUDE_API_MODELS[0];
export const DEFAULT_ANTIGRAVITY_MODEL = ANTIGRAVITY_MODELS[0];

/** Mapping from provider id to its model list (client-safe). */
export const PROVIDER_MODELS: Record<string, readonly string[]> = {
  "claude-code": CLAUDE_MODELS,
  "gemini": GEMINI_MODELS,
  "claude-api": CLAUDE_API_MODELS,
  "antigravity": ANTIGRAVITY_MODELS,
};

/**
 * Dynamically determine model capability tier based on name keywords and versioning.
 * Removes the need to hardcode specific model revisions.
 */
export function getModelCapabilityTier(modelId: string): number {
  const lower = modelId.toLowerCase();
  
  // 1. Base score by family family keywords
  let score = 0;
  if (lower.includes("opus")) score = 80;
  else if (lower.includes("sonnet") || lower.includes("sonet")) score = 60;
  else if (lower.includes("pro")) score = 55;
  else if (lower.includes("flash")) score = 35;
  else if (lower.includes("haiku")) score = 20;
  else return DEFAULT_CAPABILITY_TIER;

  // 2. Version parsing (x.y)
  const versionMatch = lower.match(/(\d+)(?:\.|-)(\d+)/);
  if (versionMatch) {
    const major = parseInt(versionMatch[1], 10);
    const minor = parseInt(versionMatch[2], 10);
    const versionNum = major + minor / 10;
    
    if (versionNum >= 4.5) score += 20;
    else if (versionNum >= 4.0) score += 15;
    else if (versionNum >= 3.5) score += 10;
    else if (versionNum >= 3.0) score += 5;
    else if (versionNum >= 2.5) score += 5;
  } else {
    // Single digit major version
    const singleV = lower.match(/(?:-)(\d+)(?:-|$)/);
    if (singleV) {
      const v = parseInt(singleV[1], 10);
      if (v >= 4) score += 15;
      else if (v >= 3) score += 5;
    }
  }

  // 3. Suffix Modifiers
  if (lower.includes("-high")) score += 10;
  if (lower.includes("-low")) score -= 10;
  if (lower.includes("-thinking")) score += 5;

  // 4. Special Context: Bare model names (Claude Code CLI)
  if (CLAUDE_MODELS.some(m => m === lower)) {
    if (lower === "opus") return 100;
    score += 10;
  }

  return Math.min(Math.max(score, 1), 100);
}

export const DEFAULT_CAPABILITY_TIER = 50;
