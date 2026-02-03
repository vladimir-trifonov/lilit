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
