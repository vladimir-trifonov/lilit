/**
 * Settings panel component
 * Configure project-specific settings: budget limit.
 */

"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFetchJson } from "@/lib/hooks/use-fetch-json";
import { useForm } from "@/lib/hooks/use-form";
import type { ProjectSettings } from "@/types/settings";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { AntigravitySettings } from "@/components/provider-settings/antigravity-settings";

interface SettingsPanelProps {
  projectId: string;
  onClose: () => void;
}

export function SettingsPanel({ projectId, onClose }: SettingsPanelProps) {
  const { data: fetchedSettings, loading: fetchLoading } = useFetchJson<ProjectSettings>(
    `/api/settings?projectId=${projectId}`,
  );

  const settings = fetchedSettings ?? DEFAULT_SETTINGS;

  const form = useForm<Record<string, unknown>>(
    {
      budgetLimit: settings.budgetLimit,
      debateEnabled: settings.debateEnabled,
      debateAggressiveness: settings.debateAggressiveness ?? 0.5,
    } as Record<string, unknown>,
    useCallback(async (values: Record<string, unknown>) => {
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          settings: {
            ...settings,
            budgetLimit: values.budgetLimit,
            debateEnabled: values.debateEnabled,
            debateAggressiveness: values.debateAggressiveness,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
    }, [projectId, settings]),
  );

  const updateBudget = (budget: string) => {
    if (budget === "") {
      form.setValue("budgetLimit", undefined);
      return;
    }
    const value = parseFloat(budget);
    if (!isNaN(value) && value >= 0) {
      form.setValue("budgetLimit", value);
    }
  };

  // Provider-specific settings (Antigravity for now)

  if (fetchLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
        <div className="glass-raised border border-border rounded-xl p-8 shadow-2xl">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="glass-raised border border-border rounded-xl w-full max-w-lg shadow-2xl animate-fade-in-scale flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
          <div className="flex flex-col">
            <h2 className="text-lg font-medium text-foreground">Project Settings</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Configure automated limits and behavior</p>
          </div>
          <div className="flex items-center gap-2">
            {form.isDirty && (
              <Badge variant="outline" className="text-[10px] border-warning/50 text-warning bg-warning-soft/20 animate-pulse">
                Unsaved changes
              </Badge>
            )}
            <Button onClick={onClose} variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-surface-raised">
              ✕
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 bg-surface/30">
          {/* Budget Limit */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <span>💰 Budget Limit</span>
              <span className="text-xs font-normal text-muted-foreground">(USD per pipeline)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={(form.values.budgetLimit as number | undefined) ?? ""}
                onChange={(e) => updateBudget(e.target.value)}
                className="bg-surface border border-border rounded-lg pl-7 pr-3 py-2.5 text-sm w-full focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none transition-all placeholder:text-muted-foreground/30"
                placeholder="No limit"
              />
            </div>
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed bg-surface/50 p-3 rounded-lg border border-border-subtle">
              The pipeline will automatically stop if the estimated cost exceeds this amount.
              Draft runs and planning steps are not counted towards this limit.
            </p>
          </div>

          {/* Agent Debates */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <span>Agent Debates</span>
              <span className="text-xs font-normal text-muted-foreground">(opinion-driven disagreements)</span>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const newDebateEnabled = !(settings.debateEnabled !== false);
                  form.setValue("debateEnabled", newDebateEnabled);
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  (form.values.debateEnabled as boolean | undefined) !== false
                    ? "bg-brand"
                    : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    (form.values.debateEnabled as boolean | undefined) !== false
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-xs text-muted-foreground">
                {(form.values.debateEnabled as boolean | undefined) !== false ? "Enabled" : "Disabled"}
              </span>
            </div>
            {(form.values.debateEnabled as boolean | undefined) !== false && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Aggressiveness</span>
                  <span className="text-xs text-foreground font-mono">
                    {((form.values.debateAggressiveness as number | undefined) ?? 0.5).toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={(form.values.debateAggressiveness as number | undefined) ?? 0.5}
                  onChange={(e) => form.setValue("debateAggressiveness", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-brand"
                />
                <div className="flex justify-between text-[10px] text-faint">
                  <span>Polite</span>
                  <span>Opinionated</span>
                  <span>Confrontational</span>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed bg-surface/50 p-3 rounded-lg border border-border-subtle">
              When enabled, agents will challenge each other&apos;s work when it conflicts with their opinions. Higher aggressiveness lowers the trigger threshold.
            </p>
          </div>

          <AntigravitySettings />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-subtle bg-surface/50 flex justify-end gap-3">
          <Button
             onClick={onClose}
             variant="ghost"
             size="sm"
             className="text-xs"
          >
            Cancel
          </Button>
          <Button
            onClick={form.save}
            disabled={!form.isDirty || form.isSaving}
            size="sm"
            className="text-xs shadow-md"
          >
            {form.isSaving ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
