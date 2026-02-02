"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NewProjectForm } from "@/components/new-project-form";

interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
}

import { Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  projects: Project[];
  activeProject: Project | null;
  onSelect: (p: Project) => void;
  onProjectCreated: (p: Project) => void;
  isCollapsed: boolean;
  runningProjectIds?: Set<string>;
}

const COLORS = [
  "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400",
  "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400",
  "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-400",
  "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-400",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400",
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
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
    </span>
  );
}

export function ProjectSelector({
  projects,
  activeProject,
  onSelect,
  onProjectCreated,
  isCollapsed,
  runningProjectIds,
}: Props) {
  const [showNewForm, setShowNewForm] = useState(false);

  function handleProjectCreated(project: { id: string; name: string; path: string }) {
    // Convert to full Project type
    const fullProject: Project = {
      ...project,
      description: null,
    };
    onProjectCreated(fullProject);
    setShowNewForm(false);
  }

  return (
    <div className={`flex-1 overflow-auto p-2 ${isCollapsed ? "px-2" : ""}`}>
      <TooltipProvider delayDuration={0}>
        <div className={isCollapsed ? "flex flex-col items-center gap-2" : "space-y-1"}>
          {projects.map((p) => {
            const isActive = activeProject?.id === p.id;
            const isRunning = runningProjectIds?.has(p.id) ?? false;
            const initials = p.name.substring(0, 2).toUpperCase();
            const colorClass = getProjectColor(p.id);

            // Collapsed Item
            if (isCollapsed) {
              return (
                <Tooltip key={p.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onSelect(p)}
                      className={`relative w-10 h-10 rounded-md flex items-center justify-center transition-all ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary ring-offset-2 ring-offset-sidebar"
                          : `hover:ring-2 hover:ring-ring hover:ring-offset-1 hover:ring-offset-sidebar ${colorClass}`
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
                  <TooltipContent side="right">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.path}</p>
                    {isRunning && <p className="text-xs text-green-400">Running...</p>}
                  </TooltipContent>
                </Tooltip>
              );
            }

            // Expanded Item
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-3 group ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                }`}
              >
                <div className={`relative w-8 h-8 rounded flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${colorClass}`}>
                   <span className="text-xs font-bold">{initials}</span>
                   {isRunning && (
                     <span className="absolute -top-0.5 -right-0.5">
                       <RunningDot />
                     </span>
                   )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`font-medium text-sm truncate ${isActive ? "text-foreground" : "text-foreground/80 group-hover:text-foreground"}`}>{p.name}</div>
                  <div className="text-xs text-muted-foreground/70 truncate">{p.path}</div>
                </div>
              </button>
            );
          })}

          <div className={isCollapsed ? "pt-2 border-t border-sidebar-border w-full flex justify-center" : "pt-2"}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-10 h-10 rounded-md text-muted-foreground hover:text-foreground"
                    onClick={() => setShowNewForm(true)}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New Project</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                className="w-full text-muted-foreground justify-start gap-2 px-3"
                onClick={() => setShowNewForm(true)}
              >
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            )}
          </div>
        </div>
      </TooltipProvider>

      {showNewForm && (
        <NewProjectForm
          onSuccess={handleProjectCreated}
          onCancel={() => setShowNewForm(false)}
        />
      )}
    </div>
  );
}
