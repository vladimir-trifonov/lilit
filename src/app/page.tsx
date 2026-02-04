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
  const [splashDone, setSplashDone] = useLocalStorageState(SPLASH_SEEN_KEY, false);
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
  }, [setSplashDone]);

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
    <div className="flex h-screen w-full bg-transparent font-sans overflow-hidden p-3 gap-3">
      {/* Floating Sidebar Dock */}
      <aside
        className={`flex-shrink-0 bg-sidebar backdrop-blur-3xl rounded-3xl border border-white/10 shadow-2xl flex flex-col transition-all duration-500 ease-spring-bounce z-50 ${
          isCollapsed ? "w-[70px]" : "w-[260px]"
        }`}
      >
        <div className={`shrink-0 flex items-center h-16 ${isCollapsed ? "justify-center" : "px-5 justify-between"}`}>
           {isCollapsed ? (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsCollapsed(false)} 
                className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-full"
              >
                <ChevronsRight className="h-5 w-5" />
              </Button>
            ) : (
              <>
                <div className="overflow-hidden flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-accent flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-brand/20">L</div>
                  <div className="flex flex-col">
                    <h1 className="text-base font-bold tracking-tight text-foreground/90 truncate leading-none">Lilit</h1>
                    <p className="text-[10px] text-muted-foreground/80 font-medium truncate leading-none mt-1">AI Crew</p>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setIsCollapsed(true)} 
                  className="h-8 w-8 text-muted-foreground/50 hover:text-foreground hover:bg-white/5 rounded-full"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
              </>
            )}
        </div>

        <div className="flex-1 min-h-0 px-2 pb-2">
          <ProjectSelector
            projects={projects}
            activeProject={activeProject}
            onSelect={handleSelectProject}
            onDelete={handleDeleteProject}
            onNewProjectClick={() => setShowNewProjectModal(true)}
            isCollapsed={isCollapsed}
            runningProjectIds={runningProjectIds}
          />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface-floating backdrop-blur-3xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden relative transition-all duration-300">
        <ProviderAlert />
        
        {/* Floating Header */}
        <header className="h-16 absolute top-0 left-0 right-0 z-20 flex items-center px-6 justify-between bg-transparent">
          <div className="flex items-center gap-3">
             {activeProject && (
                <div className="glass px-3 py-1.5 rounded-full border-white/5 flex items-center gap-2 animate-fade-in-scale">
                    <span className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_rgba(var(--success),0.5)]" />
                    <h2 className="font-semibold text-foreground/90 text-sm tracking-wide">
                      {activeProject.name}
                    </h2>
                </div>
             )}
          </div>
          <div className="flex items-center gap-2">
            {/* Additional header actions can go here */}
          </div>
        </header>

        {/* Chat Interface Container */}
        <div className="flex-1 flex flex-col pt-16 h-full">
          {activeProject ? (
            <Chat key={activeProject.id} project={activeProject} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground space-y-6 animate-fade-in-up">
              <div className="relative">
                 <div className="absolute inset-0 bg-brand/20 blur-3xl rounded-full" />
                 <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-surface-raised to-surface border border-white/10 flex items-center justify-center text-5xl shadow-2xl">
                    🚀
                 </div>
              </div>
              <div className="text-center space-y-2 max-w-md px-6">
                <p className="text-xl font-medium text-foreground">Ready to Launch</p>
                <p className="text-sm text-muted-foreground/80 leading-relaxed">
                  Select a project from the dock or create a new one to begin your collaboration with the AI crew.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* New Project Modal */}
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
