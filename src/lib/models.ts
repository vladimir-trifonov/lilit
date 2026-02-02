/**
 * Model and agent constants — single source of truth.
 * Safe for both client and server imports (no Node.js-only deps).
 * All files that need model/agent names should import from here.
 */

// ---- Agent Types ----

/** Core agent type identifiers. PM is required; others are optional. */
export const AGENT = {
  PM: "pm",
  ARCHITECT: "architect",
  DEVELOPER: "developer",
  QA: "qa",
} as const;

export type AgentType = (typeof AGENT)[keyof typeof AGENT];

/** All known agent types as an array (for iteration). */
export const ALL_AGENT_TYPES: AgentType[] = Object.values(AGENT);

/** The PM agent is architecturally required — the orchestrator cannot function without it. */
export const REQUIRED_AGENTS: AgentType[] = [AGENT.PM];

// ---- Model Names ----

export const CLAUDE_MODELS = ["sonnet", "opus", "haiku"] as const;
export const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-pro-preview",
  "gemini-3-pro-high",
  "gemini-3-pro-low",
] as const;

/** Default model per provider (first in list) */
export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODELS[0];
export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0];
