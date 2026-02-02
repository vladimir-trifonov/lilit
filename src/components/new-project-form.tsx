/**
 * New project creation form
 * Auto-detects stack from project path and validates accessibility
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { StackType } from "@/types/settings";

interface NewProjectFormProps {
  onSuccess: (project: { id: string; name: string; path: string }) => void;
  onCancel: () => void;
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

export function NewProjectForm({ onSuccess, onCancel }: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [stack, setStack] = useState<StackType | "">("");
  const [detecting, setDetecting] = useState(false);
  const [detectedStack, setDetectedStack] = useState<StackType | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePathChange = (newPath: string) => {
    setPath(newPath);
    setPathError(null);
    setDetectedStack(null);

    // Auto-populate name from path
    if (!name && newPath) {
      const baseName = newPath.split("/").filter(Boolean).pop() || "";
      setName(baseName);
    }
  };

  const handleDetectStack = async () => {
    if (!path) return;

    setDetecting(true);
    setPathError(null);

    try {
      // Validate path first
      const validateRes = await fetch("/api/projects/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });

      const validateData = await validateRes.json();

      if (!validateData.valid) {
        setPathError(validateData.error || "Invalid path");
        setDetecting(false);
        return;
      }

      // Auto-detect stack
      const detectRes = await fetch("/api/projects/detect-stack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });

      const detectData = await detectRes.json();

      if (detectData.stack) {
        setDetectedStack(detectData.stack);
        if (!stack) {
          setStack(detectData.stack);
        }
      }
    } catch (err) {
      setPathError("Failed to validate or detect stack");
    } finally {
      setDetecting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          path: path.trim(),
          description: description.trim() || undefined,
          stack: stack || undefined,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-medium">New Project</h2>
          <Button onClick={onCancel} variant="ghost" size="sm" className="text-xs">
            Cancel
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Project Path */}
          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">
              Project Path <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => handlePathChange(e.target.value)}
                onBlur={handleDetectStack}
                placeholder="/path/to/your/project"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                required
              />
              <Button
                type="button"
                onClick={handleDetectStack}
                disabled={!path || detecting}
                variant="outline"
                size="sm"
              >
                {detecting ? "Detecting..." : "Detect"}
              </Button>
            </div>
            {pathError && (
              <p className="text-xs text-red-400 mt-1">❌ {pathError}</p>
            )}
            {detectedStack && !pathError && (
              <p className="text-xs text-green-400 mt-1">
                ✅ Detected: <Badge variant="secondary" className="text-xs ml-1">{detectedStack}</Badge>
              </p>
            )}
            <p className="text-xs text-zinc-500 mt-1">
              Absolute path to your project directory
            </p>
          </div>

          {/* Project Name */}
          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              required
            />
          </div>

          {/* Stack Selection */}
          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">
              Tech Stack
            </label>
            <select
              value={stack}
              onChange={(e) => setStack(e.target.value as StackType | "")}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            >
              <option value="">Auto-detect</option>
              {STACK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500 mt-1">
              Leave as "Auto-detect" to automatically determine from project files
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of your project..."
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-sm text-red-200">
              ❌ {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-zinc-800">
            <Button
              type="button"
              onClick={onCancel}
              variant="ghost"
              size="sm"
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name || !path || creating || !!pathError}
              size="sm"
            >
              {creating ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
