/**
 * Project settings types
 * Settings are stored as JSON in the database and can be configured per-project
 */

export type ModelType =
  | "sonnet"
  | "opus"
  | "haiku"
  | "claude-sonnet-4-5"
  | "claude-opus-4-5"
  | "gemini-2.5-flash"
  | "gemini-3-pro-preview"
  | "gemini-3-pro-high"
  | "gemini-3-pro-low";

export type StackType = "nextjs" | "react" | "python" | "nodejs" | "vue" | "svelte" | "django" | "fastapi";

export interface AgentSettings {
  enabled: boolean;
  model: ModelType;
  roles?: Record<string, { enabled: boolean; model?: ModelType }>;
}

export interface ProjectSettings {
  stack?: StackType;
  budgetLimit?: number; // Max cost in USD per pipeline run
  agents: {
    pm: AgentSettings;
    architect: AgentSettings;
    developer: AgentSettings;
    qa: AgentSettings;
  };
}

// Default settings (can be overridden by env vars)
export const DEFAULT_SETTINGS: ProjectSettings = {
  stack: undefined,
  budgetLimit: parseFloat(process.env.DEFAULT_BUDGET_LIMIT || "10.0"),
  agents: {
    pm: {
      enabled: true,
      model: (process.env.PM_MODEL as ModelType) || "gemini-3-pro-preview",
    },
    architect: {
      enabled: true,
      model: (process.env.ARCHITECT_MODEL as ModelType) || "gemini-3-pro-preview",
    },
    developer: {
      enabled: true,
      model: (process.env.DEVELOPER_MODEL as ModelType) || "sonnet",
      roles: {
        code: { enabled: true, model: (process.env.DEVELOPER_CODE_MODEL as ModelType) || "sonnet" },
        review: { enabled: true, model: (process.env.DEVELOPER_REVIEW_MODEL as ModelType) || "sonnet" },
        fix: { enabled: true, model: (process.env.DEVELOPER_FIX_MODEL as ModelType) || "sonnet" },
        devops: { enabled: true, model: (process.env.DEVELOPER_DEVOPS_MODEL as ModelType) || "sonnet" },
      },
    },
    qa: {
      enabled: true,
      model: (process.env.QA_MODEL as ModelType) || "sonnet",
      roles: {
        automation: { enabled: true, model: (process.env.QA_AUTOMATION_MODEL as ModelType) || "sonnet" },
        manual: { enabled: true, model: (process.env.QA_MANUAL_MODEL as ModelType) || "sonnet" },
      },
    },
  },
};

/**
 * Merge user settings with defaults
 */
export function mergeSettings(userSettings: Partial<ProjectSettings> | null): ProjectSettings {
  if (!userSettings) return DEFAULT_SETTINGS;

  return {
    stack: userSettings.stack ?? DEFAULT_SETTINGS.stack,
    budgetLimit: userSettings.budgetLimit ?? DEFAULT_SETTINGS.budgetLimit,
    agents: {
      pm: { ...DEFAULT_SETTINGS.agents.pm, ...userSettings.agents?.pm },
      architect: { ...DEFAULT_SETTINGS.agents.architect, ...userSettings.agents?.architect },
      developer: {
        ...DEFAULT_SETTINGS.agents.developer,
        ...userSettings.agents?.developer,
        roles: {
          ...DEFAULT_SETTINGS.agents.developer.roles,
          ...userSettings.agents?.developer?.roles,
        },
      },
      qa: {
        ...DEFAULT_SETTINGS.agents.qa,
        ...userSettings.agents?.qa,
        roles: {
          ...DEFAULT_SETTINGS.agents.qa.roles,
          ...userSettings.agents?.qa?.roles,
        },
      },
    },
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
