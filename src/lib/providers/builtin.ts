/**
 * Built-in provider adapters.
 */

import { claudeCodeAdapter } from "./claude-code.adapter";
import { geminiAdapter } from "./gemini.adapter";
import { claudeApiAdapter } from "./claude-api.adapter";
import { antigravityAdapter } from "./antigravity.adapter";
import type { ProviderAdapter } from "./types";

export const BUILTIN_PROVIDERS: ProviderAdapter[] = [
  claudeCodeAdapter,
  geminiAdapter,
  claudeApiAdapter,
  antigravityAdapter,
];