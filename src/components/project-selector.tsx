"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
}

interface Props {
  projects: Project[];
  activeProject: Project | null;
  onSelect: (p: Project) => void;
  onDelete: (p: Project) => void;
  onNewProjectClick: () => void;
  isCollapsed: boolean;
  runningProjectIds?: Set<string>;
}

const COLORS = [
  "bg-red-500/10 text-red-500",
  "bg-orange-500/10 text-orange-500",
  "bg-amber-500/10 text-amber-500",
  "bg-green-500/10 text-green-500",
  "bg-emerald-500/10 text-emerald-500",
  "bg-teal-500/10 text-teal-500",
  "bg-cyan-500/10 text-cyan-500",
  "bg-blue-500/10 text-blue-500",
  "bg-indigo-500/10 text-indigo-500",
  "bg-violet-500/10 text-violet-500",
  "bg-purple-500/10 text-purple-500",
  "bg-fuchsia-500/10 text-fuchsia-500",
  "bg-pink-500/10 text-pink-500",
  "bg-rose-500/10 text-rose-500",
];

function getProjectColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function RunningDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
    </span>
  );
}

export function ProjectSelector({
  projects,
  activeProject,
  onSelect,
  onDelete,
  onNewProjectClick,
  isCollapsed,
  runningProjectIds,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function handleDeleteClick(e: React.MouseEvent, project: Project) {
    e.stopPropagation();
    setConfirmingId(project.id);
  }

  function handleConfirmDelete(e: React.MouseEvent, project: Project) {
    e.stopPropagation();
    onDelete(project);
    setConfirmingId(null);
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingId(null);
  }

  return (
    <div className={`flex-1 overflow-auto p-2 ${isCollapsed ? "px-2" : ""}`}>
      <TooltipProvider delayDuration={0}>
        <div className={isCollapsed ? "flex flex-col items-center gap-2" : "space-y-1"}>
          {projects.map((p) => {
            const isActive = activeProject?.id === p.id;
            const isRunning = runningProjectIds?.has(p.id) ?? false;
            const isConfirming = confirmingId === p.id;
            const initials = p.name.substring(0, 2).toUpperCase();
            const colorClass = getProjectColor(p.id);

            // Collapsed Item
            if (isCollapsed) {
              return (
                <Tooltip key={p.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onSelect(p)}
                      className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 ${
                        isActive
                          ? "bg-brand text-white shadow-md shadow-brand/20 scale-105"
                          : `hover:bg-surface-raised hover:scale-105 border border-transparent hover:border-border-subtle ${colorClass}`
                      } ${!isActive && colorClass}`}
                    >
                      <span className="text-xs font-bold tracking-tight">{initials}</span>
                      {isRunning && (
                        <span className="absolute -top-0.5 -right-0.5">
                          <RunningDot />
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="glass-raised border-border-subtle">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground max-w-[200px] truncate">{p.path}</p>
                    {isRunning && <p className="text-xs text-success mt-1">Pipeline running</p>}
                  </TooltipContent>
                </Tooltip>
              );
            }

            // Inline delete confirmation
            if (isConfirming) {
              return (
                <div
                  key={p.id}
                  className="w-full px-3 py-2.5 rounded-lg border border-destructive/30 bg-destructive-soft/5 space-y-2 animate-fade-in"
                >
                  <p className="text-xs text-foreground">
                    Delete <span className="font-medium">{p.name}</span>?
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Project data will be archived. Files on disk are kept.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive-soft hover:text-destructive"
                      onClick={(e) => handleConfirmDelete(e, p)}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 text-muted-foreground"
                      onClick={handleCancelDelete}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              );
            }

            // Expanded Item
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200 flex items-center gap-3 group border border-transparent ${
                  isActive
                    ? "bg-surface-raised shadow-sm border-border-subtle"
                    : "hover:bg-surface/50 hover:border-border-subtle"
                }`}
              >
                <div className={`relative w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${colorClass}`}>
                   <span className="text-[10px] font-bold">{initials}</span>
                   {isRunning && (
                     <span className="absolute -top-0.5 -right-0.5">
                       <RunningDot />
                     </span>
                   )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`font-medium text-sm truncate transition-colors ${isActive ? "text-foreground" : "text-foreground/70 group-hover:text-foreground"}`}>{p.name}</div>
                  <div className="text-[10px] text-muted-foreground/60 truncate font-mono">{p.path}</div>
                </div>
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                )}
                {!isRunning && (
                  <button
                    onClick={(e) => handleDeleteClick(e, p)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive-soft/20 text-muted-foreground hover:text-destructive"
                    title="Delete project"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </button>
            );
          })}

          <div className={isCollapsed ? "pt-2 border-t border-border-subtle w-full flex justify-center" : "pt-2"}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-10 h-10 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-raised"
                    onClick={onNewProjectClick}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New Project</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                className="w-full text-muted-foreground justify-start gap-2 px-3 hover:text-foreground hover:bg-surface-raised border border-dashed border-border-subtle/50 hover:border-border-subtle"
                onClick={onNewProjectClick}
              >
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            )}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
