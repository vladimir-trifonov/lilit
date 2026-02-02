"use client";

import { useState, useEffect, useRef } from "react";
import { Chat } from "@/components/chat";
import { ProjectSelector } from "@/components/project-selector";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { PanelImperativeHandle } from "react-resizable-panels";

interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const sidebarRef = useRef<PanelImperativeHandle>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects);
  }, []);

  const toggleSidebar = () => {
    const sidebar = sidebarRef.current;
    if (sidebar) {
      if (isCollapsed) {
        sidebar.expand();
      } else {
        sidebar.collapse();
      }
    }
  };

  return (
    <div className="h-screen bg-background text-foreground font-sans overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel
          panelRef={sidebarRef}
          defaultSize={18}
          minSize={12}
          maxSize={30}
          collapsible={true}
          collapsedSize={4}
          onResize={(size) => {
            const collapsed = size.asPercentage <= 10;
            if (collapsed !== isCollapsed) {
              setIsCollapsed(collapsed);
            }
          }}
          className="border-r border-sidebar-border bg-sidebar flex flex-col z-20"
        >
          <div className={`border-b border-sidebar-border shrink-0 flex items-center h-14 ${isCollapsed ? "justify-center p-0" : "px-4 justify-between"}`}>
            {isCollapsed ? (
              <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8">
                <ChevronsRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-sidebar-foreground">Lilit</h1>
                  <p className="text-xs text-muted-foreground">AI Development Team</p>
                </div>
                <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          <ProjectSelector
            projects={projects}
            activeProject={activeProject}
            onSelect={setActiveProject}
            onProjectCreated={(p) => {
              setProjects((prev) => [p, ...prev]);
              setActiveProject(p);
            }}
            isCollapsed={isCollapsed}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={82} minSize={30}>
          {/* Main - Soft Gradient Section */}
          <div className="flex flex-col min-w-0 section-soft h-full overflow-hidden">
            <div className="flex-1 flex flex-col container-wrapper h-full py-6 min-h-0">
              {activeProject ? (
                <Chat project={activeProject} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground animate-fade-in-up">
                  <div className="text-center">
                    <p className="text-3xl mb-4">👋</p>
                    <h2 className="text-xl font-medium text-foreground mb-2">Welcome to Lilit</h2>
                    <p className="text-sm opacity-80">Select or create a project to start building.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
