"use client";

import { useState, useEffect } from "react";
import { Chat } from "@/components/chat";
import { ProjectSelector } from "@/components/project-selector";

interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects);
  }, []);

  return (
    <div className="flex h-screen bg-background text-foreground font-sans">
      {/* Sidebar */}
      <div className="w-72 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <h1 className="text-lg font-semibold tracking-tight">Crew</h1>
          <p className="text-xs text-muted-foreground mt-1">AI Development Team</p>
        </div>
        <ProjectSelector
          projects={projects}
          activeProject={activeProject}
          onSelect={setActiveProject}
          onProjectCreated={(p) => {
            setProjects((prev) => [p, ...prev]);
            setActiveProject(p);
          }}
        />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col bg-background">
        {activeProject ? (
          <Chat project={activeProject} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-2xl mb-2">👋</p>
              <p>Select or create a project to start</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
