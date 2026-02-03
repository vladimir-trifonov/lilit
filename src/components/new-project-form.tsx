/**
 * New project creation form
 * Browse for a folder via native OS picker, auto-detects stack
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/utils";

interface NewProjectFormProps {
  onSuccess: (project: { id: string; name: string; path: string }) => void;
  onCancel: () => void;
}

export function NewProjectForm({ onSuccess, onCancel }: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [detectedStack, setDetectedStack] = useState<string | null>(null);
  const [pathCreated, setPathCreated] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setPathAndName = (newPath: string) => {
    setPath(newPath);
    setPathError(null);
    setPathCreated(false);
    setDetectedStack(null);

    // Auto-populate name from path
    if (!name && newPath) {
      const baseName = newPath.split("/").filter(Boolean).pop() || "";
      setName(baseName);
    }
  };

  const validateAndDetect = async (targetPath: string) => {
    if (!targetPath) return;

    setDetecting(true);
    setPathError(null);
    setPathCreated(false);

    try {
      const validateRes = await apiFetch("/api/projects/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath }),
      });

      const validateData = await validateRes.json();

      if (!validateData.valid) {
        setPathError(validateData.error || "Invalid path");
        setDetecting(false);
        return;
      }

      if (validateData.created) {
        setPathCreated(true);
      }

      // Auto-detect stack
      const detectRes = await apiFetch("/api/projects/detect-stack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath }),
      });

      const detectData = await detectRes.json();

      if (detectData.stack) {
        setDetectedStack(detectData.stack);
      }
    } catch {
      setPathError("Failed to validate path");
    } finally {
      setDetecting(false);
    }
  };

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const res = await apiFetch("/api/browse");
      const data = await res.json();

      if (data.path) {
        setPathAndName(data.path);
        await validateAndDetect(data.path);
      }
    } catch {
      // Dialog cancelled or failed — ignore
    } finally {
      setBrowsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);

    try {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          path: path.trim(),
          description: description.trim() || undefined,
          stack: detectedStack || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create project");
      }

      onSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="glass-raised border border-border rounded-xl w-full max-w-2xl shadow-2xl animate-fade-in-scale">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-medium text-foreground">New Project</h2>
          <Button onClick={onCancel} variant="ghost" size="sm" className="text-xs">
            Cancel
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 bg-surface/30">
          {/* Project Path */}
          <div>
            <label className="text-sm font-medium text-foreground block mb-2">
              Project Path <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPathAndName(e.target.value)}
                onBlur={() => validateAndDetect(path)}
                placeholder="/path/to/your/project"
                className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
                required
              />
              <Button
                type="button"
                onClick={handleBrowse}
                disabled={browsing || detecting}
                variant="outline"
                size="sm"
                className="shadow-sm"
              >
                {browsing ? "Opening..." : "Browse"}
              </Button>
            </div>
            {pathError && (
              <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                <span>⚠</span> {pathError}
              </p>
            )}
            {pathCreated && !pathError && (
              <p className="text-xs text-info mt-1.5">
                Target directory will be created
              </p>
            )}
            {detectedStack && !pathError && (
              <p className="text-xs text-success mt-1.5 flex items-center gap-1">
                <span>✓</span> Detected: <Badge variant="secondary" className="text-[10px] ml-1 bg-brand-soft/20 text-brand-foreground border-brand/10">{detectedStack}</Badge>
              </p>
            )}
            {detecting && (
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full border border-muted-foreground border-t-transparent animate-spin"/> Identifying technology stack...
              </p>
            )}
          </div>

          {/* Project Name */}
          <div>
            <label className="text-sm font-medium text-foreground block mb-2">
              Project Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-foreground block mb-2">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of your project..."
              rows={3}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-destructive-soft border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle mt-2">
            <Button
              type="button"
              onClick={onCancel}
              variant="ghost"
              size="sm"
              disabled={creating}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name || !path || creating || !!pathError}
              size="sm"
              className="text-xs shadow-md"
            >
              {creating ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
