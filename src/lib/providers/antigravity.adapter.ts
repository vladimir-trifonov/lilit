/**
 * Google Antigravity adapter — free-tier access to Gemini and Claude models
 * via Google OAuth tokens. Supports automatic account rotation on rate limits.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { existsSync } from "fs";
import { ANTIGRAVITY_MODELS, DEFAULT_ANTIGRAVITY_MODEL } from "../models";
import { getActiveToken, markRateLimited, getOpenCodeAccountsPath } from "../antigravity-tokens";
import { classifyError } from "../errors";
import type { ProviderAdapter, ProviderInfo, ExecutionContext, ExecutionResult } from "./types";

/** Strip the `antigravity-` prefix to get the underlying Google API model ID. */
function resolveGoogleModelId(alias: string): string {
  return alias.startsWith("antigravity-") ? alias.slice("antigravity-".length) : alias;
}

const MAX_RETRIES = 3;

function is429(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? "";
  return /429|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(msg);
}

export const antigravityAdapter: ProviderAdapter = {
  id: "antigravity",
  name: "Google Antigravity",
  capabilities: {
    fileAccess: false,
    shellAccess: false,
    toolUse: false,
    subAgents: false,
  },
  models: [...ANTIGRAVITY_MODELS],

  detect(): ProviderInfo {
    const info: ProviderInfo = {
      id: this.id,
      name: this.name,
      available: false,
      models: [...this.models],
      capabilities: { ...this.capabilities },
    };

    // Available if OAuth credentials are configured OR OpenCode tokens exist
    if (process.env.ANTIGRAVITY_CLIENT_ID) {
      info.available = true;
    } else if (existsSync(getOpenCodeAccountsPath())) {
      info.available = true;
    } else {
      info.reason = "No Antigravity accounts configured (set ANTIGRAVITY_CLIENT_ID or import OpenCode tokens)";
    }

    return info;
  },

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const modelAlias = ctx.model || DEFAULT_ANTIGRAVITY_MODEL;
    const googleModelId = resolveGoogleModelId(modelAlias);
    const startTime = Date.now();

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const token = await getActiveToken();
      if (!token) {
        return {
          output: "Error: No available Antigravity accounts",
          success: false,
          errorKind: "transient",
          durationMs: Date.now() - startTime,
        };
      }

      try {
        const google = createGoogleGenerativeAI({
          apiKey: "unused", // required by SDK but overridden by auth header
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });

        const { text, usage } = await generateText({
          model: google(googleModelId),
          system: ctx.systemPrompt,
          prompt: ctx.prompt,
          maxOutputTokens: ctx.maxTokens ?? 8192,
        });

        const u = usage as unknown as Record<string, number> | undefined;
        const inputTokens = u?.promptTokens ?? u?.inputTokens ?? 0;
        const outputTokens = u?.completionTokens ?? u?.outputTokens ?? 0;

        return {
          output: text,
          success: true,
          durationMs: Date.now() - startTime,
          tokensUsed: { inputTokens, outputTokens },
        };
      } catch (err: unknown) {
        if (is429(err) && attempt < MAX_RETRIES - 1) {
          await markRateLimited(token.accountId);
          continue; // retry with next account
        }

        const e = err as { message?: string };
        const errorMsg = e.message ?? "Unknown Antigravity error";

        return {
          output: `Error: ${errorMsg}`,
          success: false,
          errorKind: classifyError(errorMsg),
          durationMs: Date.now() - startTime,
        };
      }
    }

    return {
      output: "Error: All Antigravity accounts rate-limited",
      success: false,
      errorKind: "transient",
      durationMs: Date.now() - startTime,
    };
  },
};
