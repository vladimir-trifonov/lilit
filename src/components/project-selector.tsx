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

interface Props {
  projects: Project[];
  activeProject: Project | null;
  onSelect: (p: Project) => void;
  onProjectCreated: (p: Project) => void;
}

export function ProjectSelector({
  projects,
  activeProject,
  onSelect,
  onProjectCreated,
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
    <div className="flex-1 overflow-auto p-2">
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p)}
          className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors ${
            activeProject?.id === p.id
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          <div className="font-medium text-sm">{p.name}</div>
          <div className="text-xs text-muted-foreground/70 truncate">{p.path}</div>
        </button>
      ))}

      <Button
        variant="ghost"
        className="w-full mt-2 text-muted-foreground"
        onClick={() => setShowNewForm(true)}
      >
        + New Project
      </Button>

      {showNewForm && (
        <NewProjectForm
          onSuccess={handleProjectCreated}
          onCancel={() => setShowNewForm(false)}
        />
      )}
    </div>
  );
}
