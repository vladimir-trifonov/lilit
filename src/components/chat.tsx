"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { SHOW_LOG_KEY, ENHANCED_LOG_KEY, INPUT_POS_KEY } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { PipelineSteps } from "@/components/pipeline-steps";
import { CostDisplay } from "@/components/cost-display";
import { SettingsPanel } from "@/components/settings-panel";
import { EnhancedLogPanel } from "@/components/enhanced-log-panel";
import { PlanConfirmation } from "@/components/plan-confirmation";
import { AgentsPanel } from "@/components/agents-panel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePipeline } from "@/lib/hooks/use-pipeline";
import { useMessages } from "@/lib/hooks/use-messages";
import type { StepInfo, DbTask, PastRun, PipelineTaskView } from "@/types/pipeline";
import { StandupThread, type StandupMessageData } from "@/components/standup-thread";
import { AgentMessageThread, type AgentMessageData } from "@/components/agent-message-thread";
import { PMQuestionCard } from "@/components/pm-question-card";
import { TeamChatWindow } from "@/components/team-chat-window";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { Rnd } from "react-rnd";

interface Project {
  id: string;
  name: string;
  path: string;
}

export function Chat({ project }: { project: Project }) {
  const [showLog, setShowLog] = useLocalStorageState(SHOW_LOG_KEY, true);
  const [showSettings, setShowSettings] = useState(false);
  const [useEnhancedLog, setUseEnhancedLog] = useLocalStorageState(ENHANCED_LOG_KEY, true);
  const [showAgents, setShowAgents] = useState(false);
  const [inputPos, setInputPos] = useLocalStorageState<{ x: number; y: number } | null>(INPUT_POS_KEY, null);
  const [mounted, setMounted] = useState(false);
  const [focusSource, setFocusSource] = useState<'input' | 'team' | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Global click-away to clear focus
  useEffect(() => {
    if (!focusSource) return;
    const handleClick = (e: MouseEvent) => {
      // Check if click is outside Rnd/TeamChat containers
      if (!(e.target as HTMLElement).closest('.react-draggable') && 
          !(e.target as HTMLElement).closest('.team-chat-drag-handle')) {
        setFocusSource(null);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [focusSource]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const logPanelRef = useRef<HTMLDivElement>(null);
  const didInitialLogScroll = useRef(false);

  const pipeline = usePipeline(project.id);

  const { messages, currentConversationId, input, setInput, handleSend, hasMore, loadingMore, loadMore } = useMessages({
    projectId: project.id,
    onSendStart: pipeline.startRun,
    onSendEnd: useCallback(() => {
      pipeline.refetchStatus();
    }, [pipeline]),
  });

  // Auto-scroll messages (includes loading state so thinking bubble scrolls into view)
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pipeline.loading, pipeline.pendingQuestion, pipeline.pendingPlan]);

  // Infinite scroll: load older messages when sentinel enters viewport
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          // Preserve scroll position when prepending
          const container = scrollContainerRef.current;
          const prevHeight = container?.scrollHeight ?? 0;
          loadMore().then(() => {
            if (container) {
              const newHeight = container.scrollHeight;
              container.scrollTop += newHeight - prevHeight;
            }
          });
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  // Auto-scroll log panel (both enhanced and simple modes)
  useEffect(() => {
    if (!logPanelRef.current) return;
    if (pipeline.loading) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
    } else if (!didInitialLogScroll.current && pipeline.logContent) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
      didInitialLogScroll.current = true;
    }
  }, [pipeline.logContent, pipeline.loading]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Header - Transparent & Floating */}
      <div className="relative h-10 flex items-center px-6 gap-3 z-20 shrink-0 border-b border-white/5">
        <h2 className="font-medium text-foreground/80 text-sm hidden">{project.name}</h2>
        <span className="text-[10px] text-muted-foreground/50 font-mono tracking-wider">{project.path}</span>
        {/* Project-level cost (always shown) */}
        <CostDisplay projectId={project.id} compact className="ml-4 opacity-70 hover:opacity-100 transition-opacity" />
        
        {/* Stylish Gradient Divider */}
        <div className="absolute bottom-[-1px] left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand/30 to-transparent" />
        <div className="absolute bottom-[-1px] left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent animate-pulse" />
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAgents(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 h-7"
          >
            🤖 Agents
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 h-7"
          >
            ⚙️ Settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLog(!showLog)}
            className="text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 h-7"
          >
            {showLog ? "Hide" : "Show"} Log
          </Button>
          {pipeline.loading && (
            <Button
              variant="destructive"
              size="sm"
              onClick={pipeline.abort}
              className="text-[10px] h-7 px-3 bg-destructive/80 hover:bg-destructive text-white shadow-lg shadow-destructive/20"
            >
              ■ Stop
            </Button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 h-full overflow-hidden relative">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={showLog ? 60 : 100} minSize={30} className="bg-transparent">
            {/* Messages */}
            <ScrollArea className="h-full w-full">
              <div ref={scrollContainerRef} className="max-w-4xl mx-auto space-y-6 p-4 md:p-8 min-h-full pb-40">
                {/* Sentinel for infinite scroll — triggers loadMore when visible */}
                <div ref={topSentinelRef} className="h-px w-full" />
                {loadingMore && (
                  <div className="flex items-center justify-center py-4">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                  </div>
                )}
                {messages.length === 0 && !pipeline.loading && !pipeline.resumableRun && (
                  <div className="flex flex-col items-center justify-center min-h-[50vh] animate-fade-in-up md:px-20">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand/20 to-accent/10 border border-white/5 flex items-center justify-center text-4xl mb-6 shadow-2xl shadow-brand/10">
                       ✨
                    </div>
                    <p className="text-xl font-medium text-foreground mb-2">Start Building</p>
                    <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
                      Lilit is ready. Describe your task, ask a question, or correct a bug.
                    </p>
                  </div>
                )}

                {/* Restart banner for aborted runs */}
                {pipeline.resumableRun && !pipeline.loading && (
                  <div className="bg-warning-soft/30 border border-warning/20 rounded-2xl p-5 space-y-3 animate-fade-in backdrop-blur-md">
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                      <span className="text-xs font-semibold text-warning tracking-wide uppercase">Pipeline Paused</span>
                    </div>
                    <p className="text-sm text-foreground/80">
                      {pipeline.resumableRun.userMessage}
                    </p>
                    <div className="flex items-center gap-3 pt-1">
                      <Button onClick={pipeline.restart} size="sm" className="text-xs shadow-lg shadow-warning/20 bg-warning hover:bg-warning/90 text-black border-none">
                        Resume Run
                      </Button>
                      <Button
                        onClick={pipeline.dismissResumable}
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}

                {(pipeline.loading || pipeline.failedRun) && (
                  <div className="space-y-6 py-4 animate-fade-in">
                    {pipeline.loading ? (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center border border-brand/20">
                           <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                        </div>
                        <span className="text-sm font-medium text-brand animate-pulse">Lilit is working...</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/20">
                           <span className="text-destructive text-sm font-bold">&times;</span>
                        </div>
                        <span className="text-sm font-medium text-destructive">Pipeline failed</span>
                      </div>
                    )}

                    <div className="pl-11">
                         {(pipeline.tasks.length > 0 || pipeline.pipelineSteps.length > 0) && (
                           <div className={`rounded-2xl p-4 border ${pipeline.failedRun ? "border-destructive/20" : "border-border-subtle/50"}`}>
                             <PipelineSteps steps={pipeline.pipelineSteps} tasks={pipeline.tasks} pipelineView={pipeline.pipelineView} />
                           </div>
                         )}
                         {pipeline.failedRun && (
                           <div className="mt-4 bg-destructive-soft/30 border border-destructive/20 rounded-2xl p-5 space-y-3 animate-fade-in backdrop-blur-md">
                             <p className="text-sm text-foreground/80">
                               Some tasks encountered errors. You can resume to retry failed tasks, or dismiss to move this run to history.
                             </p>
                             <div className="flex items-center gap-3 pt-1">
                               <Button onClick={pipeline.resumeFailedRun} size="sm" className="text-xs shadow-lg shadow-destructive/20 bg-destructive hover:bg-destructive/90 text-white border-none">
                                 Resume
                               </Button>
                               <Button onClick={pipeline.dismissFailedRun} variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
                                 Dismiss
                               </Button>
                             </div>
                           </div>
                         )}
                         {pipeline.loading && pipeline.pendingPlan && (
                           <div className="mt-4">
                             <PlanConfirmation
                               projectId={project.id}
                               runId={pipeline.pendingPlan.runId}
                               plan={pipeline.pendingPlan.plan as { analysis: string; tasks: { id: number; title: string; description: string; agent: string; role: string; acceptanceCriteria?: string[]; provider?: string; model?: string }[]; pipeline: string[] }}
                               onConfirmed={pipeline.clearPendingPlan}
                               onRejected={pipeline.clearPendingPlan}
                             />
                           </div>
                         )}
                         {pipeline.loading && pipeline.pendingQuestion && (
                           <div className="mt-4">
                             <PMQuestionCard
                               question={pipeline.pendingQuestion.question}
                               context={pipeline.pendingQuestion.context}
                               onAnswer={pipeline.answerQuestion}
                             />
                           </div>
                         )}
                         {currentConversationId && (
                           <div className="mt-2">
                             <CostDisplay
                               projectId={project.id}
                               conversationId={currentConversationId}
                               compact
                             />
                           </div>
                         )}
                    </div>
                  </div>
                )}

                <div ref={scrollRef} />
              </div>
            </ScrollArea>
            
            {/* Main message area remains */}

          </ResizablePanel>

          {showLog && (
            <>
              <ResizableHandle withHandle className="bg-white/5 w-[1px] hover:bg-white/10 transition-colors" />
              <ResizablePanel defaultSize={40} minSize={20} className="backdrop-blur-xl">
                {/* Log panel (right side) */}
                <div className="flex flex-col h-full min-h-0">
                  <div className="h-10 flex items-center px-4 gap-2 shrink-0 border-b border-white/5 bg-[#131522] z-20">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Activity Log</span>
                    {pipeline.currentAgent && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-brand-soft/50 text-brand-foreground border border-brand/20 animate-pulse ml-2">
                        {pipeline.currentAgent}
                      </Badge>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                       {pipeline.loading && (
                        <div className="flex items-center gap-1.5 mr-2">
                           <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand"></span>
                            </span>
                        </div>
                      )}
                      <Button
                        onClick={() => setUseEnhancedLog(!useEnhancedLog)}
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-muted-foreground hover:bg-white/5 rounded-md"
                        title={useEnhancedLog ? "Switch to simple view" : "Switch to enhanced view"}
                      >
                        {useEnhancedLog ? "Simple" : "Enhanced"}
                      </Button>
                    </div>
                  </div>

                  {(() => {
                    const hasCurrentLog = !!(pipeline.logContent || pipeline.loading);
                    const anyExpanded = pipeline.pastRuns.some(r => r.expanded);
                    const logContentClass = anyExpanded ? "h-0 overflow-hidden" : "flex-1 min-h-0 overflow-auto";
                    const historyContainerClass = anyExpanded ? "flex-1" : (!hasCurrentLog ? "flex-1" : "max-h-[30%]");
                    
                    return (
                      <>
                        {/* Current pipeline log — scrolls independently, takes remaining space */}
                        {(pipeline.logContent || pipeline.loading) ? (
                          <div ref={logPanelRef} className={logContentClass}>
                            {useEnhancedLog ? (
                              <EnhancedLogPanel
                                logContent={pipeline.logContent}
                                loading={pipeline.loading}
                                currentAgent={pipeline.currentAgent}
                              />
                            ) : (
                              <pre
                                className="p-4 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words leading-relaxed"
                              >
                                {pipeline.logContent || "Ready..."}
                              </pre>
                            )}
                          </div>
                        ) : pipeline.pastRuns.length === 0 ? (
                          <div className={logContentClass}>
                            {useEnhancedLog ? (
                              <div className="h-full">
                                <EnhancedLogPanel logContent="" loading={false} currentAgent={null} />
                              </div>
                            ) : (
                              <pre className="flex-1 p-4 text-xs text-muted-foreground font-mono">
                                Ready...
                              </pre>
                            )}
                          </div>
                        ) : null}

                        {/* Past pipeline runs — compact when collapsed, expands when an item is open */}
                        {pipeline.pastRuns.length > 0 && (
                          <div className={`${historyContainerClass} overflow-auto ${hasCurrentLog && !anyExpanded ? "border-t border-white/5" : ""}`}>
                            <div className="px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-[#131522] border-b border-white/5 sticky top-0 z-10">
                              History
                            </div>
                            {pipeline.pastRuns.map((run) => (
                              <PastRunEntry
                                key={run.runId}
                                run={run}
                                useEnhancedLog={useEnhancedLog}
                                onExpand={pipeline.expandPastRun}
                                onCollapse={pipeline.collapsePastRun}
                              />
                            ))}
                            {pipeline.hasMorePastRuns && (
                              <div className="px-3 py-3">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={pipeline.loadMorePastRuns}
                                  className="w-full text-xs text-muted-foreground hover:bg-white/5"
                                >
                                  Load more runs
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          projectId={project.id}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Agents Panel */}
      <div style={{ display: showAgents ? undefined : "none" }}>
        <AgentsPanel onClose={() => setShowAgents(false)} />
      </div>

      {/* Floating Team Chat */}
      <TeamChatWindow
        projectId={project.id}
        pipelineLoading={pipeline.loading}
        isFocused={focusSource === 'team'}
        onFocus={() => setFocusSource('team')}
      />


      {/* Input - Levitating Bar (Draggable & Portal-ed to top level) */}
      {mounted && createPortal(
        <Rnd
          position={inputPos || { 
            x: (window.innerWidth - 336) / 2, 
            y: window.innerHeight - 140 
          }}
          onDragStart={() => setFocusSource('input')}
          onDragStop={(_e, d) => setInputPos({ x: d.x, y: d.y })}
          onPointerDown={() => setFocusSource('input')}
          enableResizing={false}
          minWidth={336}
          maxWidth={336}
          bounds="window"
          dragHandleClassName="input-drag-handle"
          className="z-[9999] !fixed group" // Highest priority
          style={{ width: 336, height: 'auto' }}
        >
          <div className="w-full pointer-events-auto">
             <div className={`input-drag-handle glass-floating cursor-grab active:cursor-grabbing rounded-[26px] px-2 py-1.5 flex flex-col gap-1.5 relative group focus-within:ring-1 transition-all duration-500 ease-out max-h-[400px] overflow-hidden ${
               focusSource === 'input' 
                 ? 'opacity-100 scale-100 ring-brand/50 border-brand' 
                 : 'opacity-85 hover:opacity-95'
             } scale-[0.98] group-focus-within:scale-100`}>
                <Textarea
                  placeholder={pipeline.loading ? "Running..." : "Ask Lilit..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setFocusSource('input')}
                  rows={1}
                  className="bg-transparent border-none resize-none min-h-[36px] max-h-[300px] overflow-y-auto text-[14px] leading-5 px-4 py-1.5 focus-visible:ring-0 placeholder:text-muted-foreground/50"
                  style={{ boxShadow: 'none' }}
                />
                <div className="flex items-center justify-between px-2 pb-1 opacity-80 group-focus-within:opacity-100 transition-opacity">
                   <div className="flex items-center gap-1">
                      {/* Future attachments or tools buttons could go here */}
                   </div>
                   <Button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className={`rounded-full w-8 h-8 p-0 flex items-center justify-center transition-all duration-300 ${input.trim() ? "bg-brand text-white shadow-lg shadow-brand/25 scale-100" : "bg-white/5 text-white/20 scale-90"}`}
                      size="icon"
                    >
                      <span className="text-xs">↑</span>
                    </Button>
                </div>
                
                {/* Glow effect on focus */}
                <div className={`absolute -inset-px rounded-[29px] bg-gradient-to-r from-brand/50 via-accent/50 to-brand/50 -z-10 blur-xl transition-opacity duration-1000 ${
                  focusSource === 'input' ? 'opacity-100' : 'opacity-0'
                }`} />
             </div>
          </div>
        </Rnd>,
        document.body
      )}
    </>
  );
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

interface Message {
  id: string;
  role: string;
  content: string;
  metadata?: string;
  createdAt: string;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  let steps: StepInfo[] = [];
  let metaTasks: DbTask[] = [];
  let standupMessages: StandupMessageData[] = [];
  let agentMessages: AgentMessageData[] = [];
  let pipelineView: PipelineTaskView[] = [];
  let debates: Array<{ challengerAgent: string; defenderAgent: string; triggerOpinion: string; outcome: string; turnCount: number; resolutionNote?: string }> = [];
  if (message.metadata) {
    try {
      const meta = JSON.parse(message.metadata);
      steps = meta.steps || [];
      metaTasks = meta.tasks || [];
      standupMessages = meta.standup?.messages || [];
      agentMessages = meta.agentMessages || [];
      pipelineView = meta.pipelineView || [];
      debates = meta.debates || [];
    } catch {
      // ignore
    }
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in-up group`}>
      <div
        className={`max-w-[72%] md:max-w-[68%] rounded-2xl px-4 py-3 shadow-sm relative overflow-hidden backdrop-blur-md transition-all duration-300 ${
          isUser
            ? "bg-gradient-to-br from-brand/90 to-accent/80 text-white rounded-br-md shadow-brand/10 border border-white/10"
            : isSystem
              ? "bg-destructive-soft text-destructive border border-destructive/20 rounded-bl-md"
              : "bg-surface-raised/40 text-foreground border border-white/5 rounded-bl-md hover:bg-surface-raised/60 hover:shadow-lg hover:shadow-black/5"
        }`}
      >
        {/* Glow for AI messages */}
        {!isUser && !isSystem && (
           <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-50" />
        )}
        
        <div className="flex items-center gap-2 mb-2">
          {!isUser && !isSystem && (
            <div className="flex items-center gap-2">
               <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-brand to-accent flex items-center justify-center shadow-lg shadow-brand/20">
                  <span className="text-[10px] text-white font-bold">L</span>
               </div>
               <span className="text-xs font-bold text-foreground/90 tracking-wide">Lilit</span>
            </div>
          )}
          <span className={`text-[10px] font-medium tracking-wide ${isUser ? "text-white/60" : "text-muted-foreground/60 group-hover:text-muted-foreground transition-colors"} ml-auto`}>
            {formatMessageTime(message.createdAt)}
          </span>
        </div>
        {isUser ? (
          <div className="text-[13px] md:text-[14px] whitespace-pre-wrap break-words leading-relaxed text-white/95">{message.content}</div>
        ) : (
          <div className="text-[13px] md:text-[14px] break-words leading-relaxed prose-chat text-foreground/90">
            <ReactMarkdown
              remarkPlugins={[remarkBreaks]}
              components={{
                h1: ({ children }) => <h3 className="text-sm font-bold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h3>,
                h2: ({ children }) => <h3 className="text-sm font-bold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h3>,
                h3: ({ children }) => <h4 className="text-[13px] font-semibold text-foreground mt-2.5 mb-1 first:mt-0">{children}</h4>,
                h4: ({ children }) => <h4 className="text-[13px] font-semibold text-muted-foreground mt-2 mb-1 first:mt-0">{children}</h4>,
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                em: ({ children }) => <em className="text-muted-foreground italic">{children}</em>,
                ul: ({ children }) => (
                  <ul className="mb-2 last:mb-0 space-y-0.5 pl-4 list-disc marker:text-brand/50">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-2 last:mb-0 space-y-0.5 pl-4 list-decimal marker:text-brand/50">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-sm pl-0.5">{children}</li>
                ),
                code: ({ children, className }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <pre className="bg-surface rounded-md px-3 py-2 my-2 overflow-x-auto border border-border-subtle">
                        <code className="text-xs font-mono text-foreground">{children}</code>
                      </pre>
                    );
                  }
                  return <code className="text-xs font-mono bg-surface/80 px-1 py-0.5 rounded border border-border-subtle text-brand">{children}</code>;
                },
                pre: ({ children }) => <>{children}</>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-brand/30 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>
                ),
                hr: () => <hr className="border-border-subtle my-3" />,
                a: ({ children, href }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2 hover:text-brand/80">{children}</a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {metaTasks.length > 0 ? (
          <div className="mt-4 pt-3 border-t border-border-subtle">
                            <PipelineSteps
                              steps={[]}
                              tasks={metaTasks}
                              pipelineView={pipelineView}
                            />
          </div>
        ) : steps.length > 0 ? (
          <div className="mt-4 pt-3 border-t border-border-subtle space-y-2">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pipeline Checklist:</div>
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs group">
                <Badge
                  variant={s.status === "done" ? "default" : "secondary"}
                  className={`text-[9px] px-1.5 py-0 h-4 ${s.status === 'done' ? 'bg-success-soft text-success' : 'bg-surface-raised text-muted-foreground'}`}
                >
                  {s.role ? `${s.agent}:${s.role}` : s.agent}
                </Badge>
                <span className={`transition-colors ${s.status === 'done' ? 'text-muted-foreground line-through decoration-border' : 'text-foreground'}`}>
                   {s.title}
                </span>
                <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                   {s.status === "done" ? "✅" : "⏳"}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {debates.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border-subtle space-y-2">
            <div className="text-xs text-destructive font-medium uppercase tracking-wider">Debates:</div>
            {debates.map((d, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-destructive-soft/30 p-2 rounded-md">
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-destructive-soft text-destructive border-destructive/20 shrink-0">
                  {d.outcome}
                </Badge>
                <span className="text-muted-foreground">
                  {d.challengerAgent} vs {d.defenderAgent}: {d.triggerOpinion.slice(0, 100)}
                  {d.resolutionNote && <span className="text-faint"> &mdash; {d.resolutionNote.slice(0, 80)}</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {agentMessages.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border-subtle">
            <AgentMessageThread messages={agentMessages} />
          </div>
        )}

        {standupMessages.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border-subtle">
            <StandupThread messages={standupMessages} />
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-success-soft text-success",
  failed: "bg-destructive-soft text-destructive",
  aborted: "bg-warning-soft text-warning",
  running: "bg-brand-soft text-brand",
};

function PastRunEntry({
  run,
  useEnhancedLog,
  onExpand,
  onCollapse,
}: {
  run: PastRun;
  useEnhancedLog: boolean;
  onExpand: (runId: string) => Promise<void>;
  onCollapse: (runId: string) => void;
}) {
  const toggleExpand = () => {
    if (run.expanded) {
      onCollapse(run.runId);
    } else {
      onExpand(run.runId);
    }
  };

  const label = run.planAnalysis
    ? run.planAnalysis.slice(0, 120) + (run.planAnalysis.length > 120 ? "..." : "")
    : run.userMessage.slice(0, 80) + (run.userMessage.length > 80 ? "..." : "");

  return (
    <div className="border-b border-border-subtle/50">
      <button
        onClick={toggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface/30 transition-colors"
      >
        <span className="text-[10px]">{run.expanded ? "▼" : "▶"}</span>
        <Badge
          variant="outline"
          className={`text-[9px] px-1.5 py-0 h-4 shrink-0 ${STATUS_COLORS[run.status] ?? "bg-muted text-muted-foreground"}`}
        >
          {run.status}
        </Badge>
        <span className="text-[11px] text-foreground truncate flex-1">
          {label}
        </span>
        {run.taskCount != null && run.taskCount > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 shrink-0 bg-surface text-muted-foreground">
            {run.taskCount} task{run.taskCount !== 1 ? "s" : ""}
          </Badge>
        )}
        <span className="text-[10px] text-faint shrink-0">
          ${run.runningCost.toFixed(2)}
        </span>
        <span className="text-[10px] text-faint shrink-0">
          {formatMessageTime(run.createdAt)}
        </span>
      </button>
      {run.expanded && (
        <div className="border-t border-border-subtle/30">
          {run.loading ? (
            <div className="flex items-center justify-center py-6">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <span className="ml-2 text-xs text-muted-foreground">Loading...</span>
            </div>
          ) : (
            <>
              {run.tasks && run.tasks.length > 0 && (
                <div className="px-3 pt-3 pb-3">
                    <PipelineSteps
                      steps={[]}
                      tasks={run.tasks}
                      pipelineView={run.pipelineView}
                    />
                </div>
              )}
              {run.logContent ? (
                useEnhancedLog ? (
                  <EnhancedLogPanel logContent={run.logContent} loading={false} currentAgent={null} />
                ) : (
                  <pre className="p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words">
                    {run.logContent}
                  </pre>
                )
              ) : (
                <div className="px-3 py-4 text-xs text-muted-foreground italic">
                  No log content available for this run.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
