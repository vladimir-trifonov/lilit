/**
 * Provider adapter types — shared interface for all AI provider integrations.
 */

import type { ErrorKind } from "../errors";

// ---- Capabilities ----

export interface ProviderCapabilities {
  fileAccess: boolean;
  shellAccess: boolean;
  toolUse: boolean;
  subAgents: boolean;
}

// ---- Provider Info (returned by detection) ----

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
  models: string[];
  capabilities: ProviderCapabilities;
}

// ---- Execution Context & Result ----

export interface ExecutionContext {
  prompt: string;
  systemPrompt: string;
  model: string;
  /** Working directory — only used by file-access providers. */
  cwd?: string;
  /** Project ID — used for logging, abort checks, and tool scoping. */
  projectId?: string;
  /** Skills to inject — only used by file-access providers. */
  skills?: string[];
  /** Label for logging (e.g. "developer:code"). */
  agentLabel?: string;
  /** Max output tokens (prompt-only providers). */
  maxTokens?: number;
  /** Timeout in milliseconds (file-access providers). */
  timeoutMs?: number;
  /** Claude CLI session ID for continuing conversations. */
  sessionId?: string;
  /** Whether to expose project data tools to the agent. */
  enableTools?: boolean;
  /** Optional callback invoked for each stream-json event (Claude Code CLI only). */
  onStreamEvent?: (event: StreamEvent) => void;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  errorKind?: ErrorKind;
  durationMs: number;
  tokensUsed?: { inputTokens: number; outputTokens: number };
}

// ---- Stream Events (Claude Code CLI stream-json) ----

export interface StreamEventSystem {
  type: "system";
  subtype: string;
  [key: string]: unknown;
}

export interface StreamEventAssistant {
  type: "assistant";
  message: {
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface StreamEventTool {
  type: "tool";
  [key: string]: unknown;
}

export interface StreamEventResult {
  type: "result";
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type StreamEvent =
  | StreamEventSystem
  | StreamEventAssistant
  | StreamEventTool
  | StreamEventResult;

// ---- Provider Adapter Interface ----

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  readonly models: string[];
  /** Detect whether this provider is available in the current environment. */
  detect(): ProviderInfo;
  /** Execute a prompt and return the result. */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
}
