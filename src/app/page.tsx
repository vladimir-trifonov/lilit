"use client";

import { useState, useEffect, useCallback } from "react";
import { Chat } from "@/components/chat";
import { ProjectSelector } from "@/components/project-selector";
import { ProviderAlert } from "@/components/provider-alert";
import { SplashScreen } from "@/components/splash-screen";
import { NewProjectForm } from "@/components/new-project-form";
import { Button } from "@/components/ui/button";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { ACTIVE_PROJECT_KEY, SPLASH_SEEN_KEY, SIDEBAR_COLLAPSED_KEY } from "@/lib/constants";
import { apiFetch } from "@/lib/utils";

interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [isCollapsed, setIsCollapsed] = useLocalStorageState(SIDEBAR_COLLAPSED_KEY, false);
  const [runningProjectIds, setRunningProjectIds] = useState<Set<string>>(new Set());
  const [splashDone, setSplashDone] = useState(false);

  // Sync splash state from localStorage after mount to avoid SSR hydration mismatch
  useEffect(() => {
    if (localStorage.getItem(SPLASH_SEEN_KEY) === "1") {
      setSplashDone(true);
    }
  }, []);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  // Load projects and restore active project from localStorage
  useEffect(() => {
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((loaded: Project[]) => {
        setProjects(loaded);

        // Restore active project from localStorage
        const savedId = localStorage.getItem(ACTIVE_PROJECT_KEY);
        if (savedId) {
          const match = loaded.find((p) => p.id === savedId);
          if (match) setActiveProject(match);
        }
      });
  }, []);

  // Persist active project selection
  const handleSelectProject = useCallback((p: Project) => {
    setActiveProject(p);
    localStorage.setItem(ACTIVE_PROJECT_KEY, p.id);
  }, []);

  // Poll for running projects every 5 seconds
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await apiFetch("/api/pipeline/active");
        const data = await res.json();
        if (active && data.projectIds) {
          setRunningProjectIds(new Set(data.projectIds));
        }
      } catch {
        // ignore
      }
    }

    poll();
    const interval = setInterval(poll, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
    localStorage.setItem(SPLASH_SEEN_KEY, "1");
  }, []);

  const handleProjectCreated = (newProject: { id: string; name: string; path: string }) => {
    const p: Project = { ...newProject, description: null };
    setProjects((prev) => [p, ...prev]);
    handleSelectProject(p);
    setShowNewProjectModal(false);
  };

  const handleDeleteProject = useCallback(async (project: Project) => {
    try {
      const res = await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) return;
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (activeProject?.id === project.id) {
        setActiveProject(null);
      }
    } catch {
      // ignore
    }
  }, [activeProject]);

  return (
    <>
    {!splashDone && <SplashScreen onComplete={handleSplashComplete} />}
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`flex-shrink-0 bg-sidebar/30 backdrop-blur-xl border-r border-border-subtle flex flex-col transition-all duration-300 ease-spring-snappy ${
          isCollapsed ? "w-[60px]" : "w-[240px]"
        }`}
      >
        <div className={`shrink-0 flex items-center h-14 border-b border-border-subtle ${isCollapsed ? "justify-center" : "px-4 justify-between"}`}>
           {isCollapsed ? (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsCollapsed(false)} 
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-surface-raised"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <div className="overflow-hidden flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-brand flex items-center justify-center text-[10px] font-bold text-white shadow-sm shadow-brand/20">L</div>
                  <div>
                    <h1 className="text-sm font-semibold tracking-tight text-foreground truncate leading-none">Lilit</h1>
                    <p className="text-[10px] text-muted-foreground truncate leading-none mt-0.5">AI Crew</p>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setIsCollapsed(true)} 
                  className="h-7 w-7 text-muted-foreground/70 hover:text-foreground hover:bg-surface-raised"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
              </>
            )}
        </div>

        <ProjectSelector
          projects={projects}
          activeProject={activeProject}
          onSelect={handleSelectProject}
          onDelete={handleDeleteProject}
          onNewProjectClick={() => setShowNewProjectModal(true)}
          isCollapsed={isCollapsed}
          runningProjectIds={runningProjectIds}
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background/50 relative">
        <ProviderAlert />
        
        {/* Header */}
        <header className="h-14 border-b border-border-subtle flex items-center px-6 justify-between bg-surface/30 backdrop-blur-md shrink-0 z-20">
          <div className="flex items-center gap-3">
            <h2 className="font-medium text-foreground text-sm">
              {activeProject ? activeProject.name : "Select a Project"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Additional header actions can go here */}
          </div>
        </header>

        {/* Chat Interface */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {activeProject ? (
            <Chat key={activeProject.id} project={activeProject} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-surface border border-border-subtle flex items-center justify-center text-3xl shadow-lg shadow-black/5">
                🚀
              </div>
              <div className="text-center space-y-1">
                <p className="font-medium text-foreground">No project selected</p>
                <p className="text-sm">Select or create a project from the sidebar to authorize the crew.</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* New Project Modal - Rendered at root level to avoid sidebar containment */}
      {showNewProjectModal && (
        <NewProjectForm
          onSuccess={handleProjectCreated}
          onCancel={() => setShowNewProjectModal(false)}
        />
      )}
    </div>
    </>
  );
}
