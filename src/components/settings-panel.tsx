/**
 * Settings panel component
 * Configure project-specific settings: models, budget limits, enabled agents
 * Dynamically loads agent list from /api/agents and models from /api/providers.
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ProjectSettings, StackType, AgentSettings } from "@/types/settings";
import { DEFAULT_SETTINGS } from "@/types/settings";

interface SettingsPanelProps {
  projectId: string;
  onClose: () => void;
}

interface ModelOption {
  value: string;
  label: string;
  category: string;
}

interface AgentInfo {
  type: string;
  name: string;
  description: string;
  provider?: string;
  model?: string;
  roles: Record<string, { role: string; name: string }>;
}

const STACK_OPTIONS: { value: StackType; label: string }[] = [
  { value: "nextjs", label: "Next.js" },
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
  { value: "nodejs", label: "Node.js" },
  { value: "python", label: "Python" },
  { value: "django", label: "Django" },
  { value: "fastapi", label: "FastAPI" },
];

export function SettingsPanel({ projectId, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [agentInfos, setAgentInfos] = useState<AgentInfo[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/settings?projectId=${projectId}`).then((r) => r.json()),
      fetch("/api/providers").then((r) => r.json()),
      fetch("/api/agents").then((r) => r.json()),
    ])
      .then(([settingsData, providersData, agentsData]) => {
        if (settingsData) setSettings(settingsData);

        // Build model options from providers
        const options: ModelOption[] = [];
        for (const provider of providersData.providers ?? []) {
          for (const model of provider.models ?? []) {
            const free = provider.id === "claude-code" ? " (Free via CLI)" : model.includes("flash") || model.includes("preview") ? " (Free)" : "";
            options.push({
              value: model,
              label: `${model}${free}`,
              category: provider.name,
            });
          }
        }
        if (options.length === 0) {
          // Fallback if providers API not available
          options.push(
            { value: "sonnet", label: "Claude Sonnet (Free via CLI)", category: "Claude" },
            { value: "opus", label: "Claude Opus (Free via CLI)", category: "Claude" },
            { value: "haiku", label: "Claude Haiku (Free via CLI)", category: "Claude" },
            { value: "gemini-2.5-flash", label: "Gemini Flash (Free)", category: "Gemini" },
            { value: "gemini-3-pro-preview", label: "Gemini 3 Pro (Free)", category: "Gemini" },
          );
        }
        setModelOptions(options);

        // Build agent info list
        const infos: AgentInfo[] = [];
        for (const agent of Object.values(agentsData.agents ?? {}) as AgentInfo[]) {
          infos.push(agent);
        }
        setAgentInfos(infos);
      })
      .catch((err) => {
        console.error("Failed to fetch settings:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, settings }),
      });

      if (res.ok) {
        setDirty(false);
      } else {
        throw new Error("Failed to save settings");
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const updateAgentModel = (agent: string, model: string) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: { ...(prev.agents[agent] ?? { enabled: true, model: "sonnet" }), model },
      },
    }));
    setDirty(true);
  };

  const toggleAgent = (agent: string) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: {
          ...(prev.agents[agent] ?? { enabled: true, model: "sonnet" }),
          enabled: !(prev.agents[agent]?.enabled ?? true),
        },
      },
    }));
    setDirty(true);
  };

  const updateBudget = (budget: string) => {
    const value = parseFloat(budget);
    if (!isNaN(value) && value >= 0) {
      setSettings((prev) => ({ ...prev, budgetLimit: value }));
      setDirty(true);
    }
  };

  const updateStack = (stack: StackType) => {
    setSettings((prev) => ({ ...prev, stack }));
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8">
          <div className="animate-spin text-2xl">⟳</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl animate-fade-in-scale">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-medium text-foreground">Project Settings</h2>
          <div className="flex items-center gap-2">
            {dirty && <Badge variant="outline" className="text-xs border-destructive/50 text-destructive">Unsaved changes</Badge>}
            <Button
              onClick={handleSave}
              disabled={!dirty || saving}
              size="sm"
              className="text-xs"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button onClick={onClose} variant="ghost" size="sm" className="text-xs">
              Close
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-6 space-y-8">
            {/* Stack Selection */}
            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
                Tech Stack
              </label>
              <select
                value={settings.stack || ""}
                onChange={(e) => updateStack(e.target.value as StackType)}
                className="bg-muted/50 border border-input rounded-md px-3 py-2 text-sm w-full focus:ring-1 focus:ring-ring outline-none"
              >
                <option value="">Auto-detect</option>
                {STACK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1.5">
                Stack determines which skills are loaded for agents
              </p>
            </div>

            {/* Budget Limit */}
            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
                Budget Limit (USD per pipeline)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.budgetLimit ?? ""}
                onChange={(e) => updateBudget(e.target.value)}
                className="bg-muted/50 border border-input rounded-md px-3 py-2 text-sm w-full focus:ring-1 focus:ring-ring outline-none"
                placeholder="No limit"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Pipeline will stop if estimated cost exceeds this amount
              </p>
            </div>

            {/* Agent Configuration — dynamic from /api/agents */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">Agent Configuration</h3>

              {agentInfos.map((agentInfo) => {
                const agentSettings: AgentSettings = settings.agents[agentInfo.type] ?? { enabled: true, model: agentInfo.model ?? "sonnet" };
                return (
                  <div key={agentInfo.type} className="border border-border/50 bg-background/50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium capitalize text-foreground">{agentInfo.name}</h4>
                        <Badge
                          variant={agentSettings.enabled ? "default" : "outline"}
                          className="text-xs"
                        >
                          {agentSettings.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <Button
                        onClick={() => toggleAgent(agentInfo.type)}
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                      >
                        {agentSettings.enabled ? "Disable" : "Enable"}
                      </Button>
                    </div>

                    {agentSettings.enabled && (
                      <div>
                        <label className="text-xs text-muted-foreground block mb-2">Model</label>
                        <select
                          value={agentSettings.model}
                          onChange={(e) => updateAgentModel(agentInfo.type, e.target.value)}
                          className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs w-full outline-none"
                        >
                          {modelOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Info */}
            <div className="bg-muted/20 border border-border/50 rounded-lg p-4 text-xs text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">Tips:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Models marked "Free via CLI" use your Claude subscription</li>
                <li>Gemini models with "Free" have generous free tiers</li>
                <li>Use cheaper models for PM/Review to optimize costs</li>
                <li>Keep Developer/QA on Claude for best code quality</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
