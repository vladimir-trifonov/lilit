/**
 * Project settings types
 * Settings are stored as JSON in the database and can be configured per-project
 */

export type ModelType = string;

export type StackType = "nextjs" | "react" | "python" | "nodejs" | "vue" | "svelte" | "django" | "fastapi";

export interface AgentSettings {
  enabled: boolean;
  model: ModelType;
  provider?: string;
  roles?: Record<string, { enabled: boolean; model?: ModelType; provider?: string }>;
}

export interface ProjectSettings {
  stack?: StackType;
  budgetLimit?: number; // Max cost in USD per pipeline run
  agents: Record<string, AgentSettings>;
}

// Default settings (can be overridden by env vars)
export const DEFAULT_SETTINGS: ProjectSettings = {
  stack: undefined,
  budgetLimit: parseFloat(process.env.DEFAULT_BUDGET_LIMIT || "10.0"),
  agents: {
    pm: {
      enabled: true,
      model: process.env.PM_MODEL || "gemini-3-pro-preview",
    },
    architect: {
      enabled: true,
      model: process.env.ARCHITECT_MODEL || "gemini-3-pro-preview",
    },
    developer: {
      enabled: true,
      model: process.env.DEVELOPER_MODEL || "sonnet",
      roles: {
        code: { enabled: true, model: process.env.DEVELOPER_CODE_MODEL || "sonnet" },
        review: { enabled: true, model: process.env.DEVELOPER_REVIEW_MODEL || "sonnet" },
        fix: { enabled: true, model: process.env.DEVELOPER_FIX_MODEL || "sonnet" },
        devops: { enabled: true, model: process.env.DEVELOPER_DEVOPS_MODEL || "sonnet" },
      },
    },
    qa: {
      enabled: true,
      model: process.env.QA_MODEL || "sonnet",
      roles: {
        automation: { enabled: true, model: process.env.QA_AUTOMATION_MODEL || "sonnet" },
        manual: { enabled: true, model: process.env.QA_MANUAL_MODEL || "sonnet" },
      },
    },
  },
};

/**
 * Merge user settings with defaults — dynamic, iterates all agents in default settings.
 */
export function mergeSettings(userSettings: Partial<ProjectSettings> | null): ProjectSettings {
  if (!userSettings) return DEFAULT_SETTINGS;

  const mergedAgents: Record<string, AgentSettings> = {};

  // Start with all default agents
  for (const [key, defaultAgent] of Object.entries(DEFAULT_SETTINGS.agents)) {
    const userAgent = userSettings.agents?.[key];
    if (!userAgent) {
      mergedAgents[key] = defaultAgent;
      continue;
    }

    mergedAgents[key] = {
      ...defaultAgent,
      ...userAgent,
      roles: {
        ...defaultAgent.roles,
        ...userAgent.roles,
      },
    };
  }

  // Include any user agents not in defaults
  if (userSettings.agents) {
    for (const [key, userAgent] of Object.entries(userSettings.agents)) {
      if (!mergedAgents[key]) {
        mergedAgents[key] = userAgent;
      }
    }
  }

  return {
    stack: userSettings.stack ?? DEFAULT_SETTINGS.stack,
    budgetLimit: userSettings.budgetLimit ?? DEFAULT_SETTINGS.budgetLimit,
    agents: mergedAgents,
  };
}

/**
 * Parse settings from database JSON string
 */
export function parseSettings(settingsJson: string | null): ProjectSettings {
  if (!settingsJson) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(settingsJson) as Partial<ProjectSettings>;
    return mergeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}
