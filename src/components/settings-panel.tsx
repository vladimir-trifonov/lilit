/**
 * Settings panel component
 * Configure project-specific settings: models, budget limits, enabled agents
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProjectSettings, ModelType, StackType, AgentSettings } from "@/types/settings";
import { DEFAULT_SETTINGS } from "@/types/settings";

interface SettingsPanelProps {
  projectId: string;
  onClose: () => void;
}

const MODEL_OPTIONS: { value: ModelType; label: string; category: string }[] = [
  { value: "sonnet", label: "Claude Sonnet 4.5 (Free via CLI)", category: "Claude" },
  { value: "opus", label: "Claude Opus 4.5 (Free via CLI)", category: "Claude" },
  { value: "haiku", label: "Claude Haiku 4 (Free via CLI)", category: "Claude" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Free)", category: "Gemini" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview (Free)", category: "Gemini" },
  { value: "gemini-3-pro-high", label: "Gemini 3 Pro High", category: "Gemini" },
  { value: "gemini-3-pro-low", label: "Gemini 3 Pro Low", category: "Gemini" },
];

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

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`/api/settings?projectId=${projectId}`);
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
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

  const updateAgentModel = (agent: keyof ProjectSettings["agents"], model: ModelType) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: { ...prev.agents[agent], model },
      },
    }));
    setDirty(true);
  };

  const toggleAgent = (agent: keyof ProjectSettings["agents"]) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: {
          ...prev.agents[agent],
          enabled: !prev.agents[agent].enabled,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-medium">Project Settings</h2>
          <div className="flex items-center gap-2">
            {dirty && <Badge variant="outline" className="text-xs">Unsaved changes</Badge>}
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
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-6">
            {/* Stack Selection */}
            <div>
              <label className="text-sm font-medium text-zinc-300 block mb-2">
                Tech Stack
              </label>
              <select
                value={settings.stack || ""}
                onChange={(e) => updateStack(e.target.value as StackType)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              >
                <option value="">Auto-detect</option>
                {STACK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-zinc-500 mt-1">
                Stack determines which skills are loaded for agents
              </p>
            </div>

            {/* Budget Limit */}
            <div>
              <label className="text-sm font-medium text-zinc-300 block mb-2">
                Budget Limit (USD per pipeline)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.budgetLimit ?? ""}
                onChange={(e) => updateBudget(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
                placeholder="No limit"
              />
              <p className="text-xs text-zinc-500 mt-1">
                Pipeline will stop if estimated cost exceeds this amount
              </p>
            </div>

            {/* Agent Configuration */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-zinc-300">Agent Configuration</h3>

              {Object.entries(settings.agents).map(([agentKey, agentSettings]) => {
                const agent = agentKey as keyof ProjectSettings["agents"];
                return (
                  <div key={agent} className="border border-zinc-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium capitalize">{agent}</h4>
                        <Badge
                          variant={agentSettings.enabled ? "default" : "outline"}
                          className="text-xs"
                        >
                          {agentSettings.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <Button
                        onClick={() => toggleAgent(agent)}
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                      >
                        {agentSettings.enabled ? "Disable" : "Enable"}
                      </Button>
                    </div>

                    {agentSettings.enabled && (
                      <div>
                        <label className="text-xs text-zinc-400 block mb-2">Model</label>
                        <select
                          value={agentSettings.model}
                          onChange={(e) => updateAgentModel(agent, e.target.value as ModelType)}
                          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs w-full"
                        >
                          {MODEL_OPTIONS.map((opt) => (
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
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 text-xs text-zinc-400 space-y-2">
              <p className="font-medium text-zinc-300">💡 Tips:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Models marked "Free via CLI" use your Claude subscription</li>
                <li>Gemini models with "Free" have generous free tiers</li>
                <li>Use cheaper models for PM/Review to optimize costs</li>
                <li>Keep Developer/QA on Claude for best code quality</li>
              </ul>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
