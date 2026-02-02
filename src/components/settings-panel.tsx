/**
 * Settings panel component
 * Configure project-specific settings: budget limit.
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ProjectSettings } from "@/types/settings";
import { DEFAULT_SETTINGS } from "@/types/settings";

interface SettingsPanelProps {
  projectId: string;
  onClose: () => void;
}

export function SettingsPanel({ projectId, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`/api/settings?projectId=${projectId}`)
      .then((r) => r.json())
      .then((settingsData) => {
        if (settingsData) setSettings(settingsData);
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

  const updateBudget = (budget: string) => {
    if (budget === "") {
      setSettings((prev) => ({ ...prev, budgetLimit: undefined }));
      setDirty(true);
      return;
    }
    const value = parseFloat(budget);
    if (!isNaN(value) && value >= 0) {
      setSettings((prev) => ({ ...prev, budgetLimit: value }));
      setDirty(true);
    }
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
      <div className="bg-surface border border-border rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl animate-fade-in-scale">
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
          <div className="p-6 space-y-6">
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
            </div>          </div>
        </div>
      </div>
    </div>
  );
}
