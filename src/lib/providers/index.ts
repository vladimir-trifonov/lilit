/**
 * Provider system — public API re-exports.
 */

// Types
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderInfo,
  ExecutionContext,
  ExecutionResult,
} from "./types";

// Registry
export {
  getAdapter,
  resolveProviderId,
  scanProviders,
  getAvailableProviders,
  getProviderForModel,
  canFallbackTo,
  getCheapestAvailableModel,
} from "./registry";

// Model constants (re-export from models.ts for backward compat)
export {
  CLAUDE_MODELS,
  GEMINI_MODELS,
  CLAUDE_API_MODELS,
  ANTIGRAVITY_MODELS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_CLAUDE_API_MODEL,
  DEFAULT_ANTIGRAVITY_MODEL,
  PROVIDER_MODELS,
} from "../models";
