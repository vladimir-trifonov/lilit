/**
 * Project settings types
 * Settings are stored as JSON in the database and can be configured per-project.
 *
 * Agent models are NOT hardcoded here. On first pipeline run, available providers
 * are detected, the first model is picked, and the choice is saved to DB per project.
 * On restart, if the saved model is no longer available, a new one is auto-picked.
 */

export type ModelType = string;

export interface AgentSettings {
  enabled: boolean;
  model: ModelType;
  provider?: string;
  roles?: Record<string, { enabled: boolean; model?: ModelType; provider?: string }>;
}

export interface ProjectSettings {
  stack?: string;
  budgetLimit?: number; // Max cost in USD per pipeline run
  personalityEnabled?: boolean; // Enable agent personalities + RAG memory (default: true)
  agents: Record<string, AgentSettings>;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  budgetLimit: parseFloat(process.env.DEFAULT_BUDGET_LIMIT || "10.0"),
  agents: {},
};

/**
 * Merge user settings with defaults.
 * Agent configs come from DB (auto-detected or user-set), not from DEFAULT_SETTINGS.
 */
export function mergeSettings(userSettings: Partial<ProjectSettings> | null): ProjectSettings {
  if (!userSettings) return DEFAULT_SETTINGS;

  return {
    stack: userSettings.stack ?? DEFAULT_SETTINGS.stack,
    budgetLimit: userSettings.budgetLimit ?? DEFAULT_SETTINGS.budgetLimit,
    personalityEnabled: userSettings.personalityEnabled ?? true,
    agents: userSettings.agents ?? {},
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
