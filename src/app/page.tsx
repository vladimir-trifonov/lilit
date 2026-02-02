"use client";

import { useState, useEffect, useCallback } from "react";
import { Chat } from "@/components/chat";
import { ProjectSelector } from "@/components/project-selector";
import { ProviderAlert } from "@/components/provider-alert";
import { SplashScreen } from "@/components/splash-screen";
import { Button } from "@/components/ui/button";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
}

const ACTIVE_PROJECT_KEY = "lilit-active-project";
const SPLASH_SEEN_KEY = "lilit-splash-seen";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [runningProjectIds, setRunningProjectIds] = useState<Set<string>>(new Set());
  const [splashDone, setSplashDone] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SPLASH_SEEN_KEY) === "1";
    }
    return false;
  });

  // Load projects and restore active project from localStorage
  useEffect(() => {
    fetch("/api/projects")
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
        const res = await fetch("/api/pipeline/active");
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

  return (
    <>
    {!splashDone && <SplashScreen onComplete={handleSplashComplete} />}
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      {/* Sidebar */}
      <div
        className={`flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out ${
          isCollapsed ? "w-[50px]" : "w-[220px]"
        }`}
      >
        <div className={`shrink-0 flex items-center h-14 border-b border-sidebar-border ${isCollapsed ? "justify-center" : "px-4 justify-between"}`}>
           {isCollapsed ? (
              <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(false)} className="h-8 w-8 hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground">
                <ChevronsRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <div className="overflow-hidden">
                  <h1 className="text-lg font-semibold tracking-tight text-sidebar-foreground truncate">Lilit</h1>
                  <p className="text-xs text-muted-foreground truncate">AI Development Team</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(true)} className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50">
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
              </>
            )}
        </div>

        <ProjectSelector
          projects={projects}
          activeProject={activeProject}
          onSelect={handleSelectProject}
          onProjectCreated={(p) => {
            setProjects((prev) => [p, ...prev]);
            handleSelectProject(p);
          }}
          isCollapsed={isCollapsed}
          runningProjectIds={runningProjectIds}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <ProviderAlert />
        <div className="flex flex-col min-w-0 section-soft h-full overflow-hidden">
             {/* Header */}
             <header className="h-14 border-b flex items-center px-6 justify-between bg-surface shrink-0 z-20 relative">
               <div className="flex items-center gap-3">
                 <h2 className="font-semibold text-foreground">
                   {activeProject ? activeProject.name : "Select a Project"}
                 </h2>
                 {activeProject?.path && (
                   <span className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded">
                     {activeProject.path}
                   </span>
                 )}
               </div>
               <div className="flex items-center gap-2">
               </div>
             </header>

             {/* Chat Interface */}
             <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
               {activeProject ? (
                 <Chat key={activeProject.id} project={activeProject} />
               ) : (
                 <div className="flex h-full items-center justify-center text-muted-foreground">
                   Select a project to start
                 </div>
               )}
             </div>
        </div>
      </div>
    </div>
    </>
  );
}
