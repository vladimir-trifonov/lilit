/**
 * Model constants — single source of truth for model names.
 * Safe for both client and server imports (no Node.js-only deps).
 * All files that need model names should import from here.
 */

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
