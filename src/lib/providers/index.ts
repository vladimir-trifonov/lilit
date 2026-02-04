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
  StreamEvent,
  StreamEventSystem,
  StreamEventAssistant,
  StreamEventTool,
  StreamEventResult,
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
  getBestAvailableModel,
  registerProvider,
  registerProviders,
} from "./registry";

// Bootstrap (register built-in adapters)
export { registerBuiltinProviders } from "./bootstrap";

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
