"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { SHOW_LOG_KEY, ENHANCED_LOG_KEY } from "@/lib/constants";
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
import type { StepInfo } from "@/types/pipeline";
import { StandupThread, type StandupMessageData } from "@/components/standup-thread";
import { AgentMessageThread, type AgentMessageData } from "@/components/agent-message-thread";
import { PMQuestionCard } from "@/components/pm-question-card";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const pipeline = usePipeline(project.id);

  const { messages, currentConversationId, input, setInput, handleSend } = useMessages({
    projectId: project.id,
    onSendStart: pipeline.startRun,
    onSendEnd: useCallback(() => {
      pipeline.refetchStatus();
    }, [pipeline]),
  });

  // Auto-scroll messages (includes loading state so thinking bubble scrolls into view)
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pipeline.loading]);

  // Auto-scroll simple log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [pipeline.logContent]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Header */}
      <div className="h-14 glass-subtle flex items-center px-4 gap-3 z-20">
        <h2 className="font-medium text-foreground">{project.name}</h2>
        <span className="text-xs text-muted-foreground font-mono">{project.path}</span>
        {/* Project-level cost (always shown) */}
        <CostDisplay projectId={project.id} compact className="ml-4" />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAgents(true)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            🤖 Agents
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(true)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ⚙️ Settings
          </Button>
          {(pipeline.loading || pipeline.logContent) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLog(!showLog)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showLog ? "Hide" : "Show"} Log
            </Button>
          )}
          {pipeline.loading && (
            <Button
              variant="destructive"
              size="sm"
              onClick={pipeline.abort}
              className="text-xs"
            >
              ■ Stop
            </Button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 h-full overflow-hidden bg-background">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={showLog && (pipeline.loading || pipeline.logContent) ? 60 : 100} minSize={30}>
            {/* Messages */}
            <ScrollArea className="h-full w-full">
              <div className="max-w-3xl mx-auto space-y-6 p-6">
                {messages.length === 0 && !pipeline.loading && !pipeline.resumableRun && (
                  <div className="text-center text-muted-foreground py-20 animate-fade-in-up">
                    <div className="w-16 h-16 rounded-full bg-brand/5 mx-auto mb-4 flex items-center justify-center">
                       <span className="text-2xl">✨</span>
                    </div>
                    <p className="text-lg font-medium text-foreground mb-1">Start building</p>
                    <p className="text-sm">Tell Lilit what to build. I&apos;m ready.</p>
                  </div>
                )}

                {/* Resume banner */}
                {pipeline.resumableRun && !pipeline.loading && (
                  <div className="bg-warning-soft border border-warning/30 rounded-xl p-4 space-y-3 animate-fade-in">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-warning">Pipeline stopped</span>
                      <Badge variant="outline" className="text-[10px] border-warning/50 text-warning">
                        Step {pipeline.resumableRun.currentStep}/{pipeline.resumableRun.totalSteps}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {pipeline.resumableRun.userMessage}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button onClick={pipeline.resume} size="sm" className="text-xs shadow-sm">
                        Resume
                      </Button>
                      <Button onClick={pipeline.restart} variant="outline" size="sm" className="text-xs bg-transparent">
                        Restart
                      </Button>
                      <Button
                        onClick={pipeline.dismissResumable}
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}

                {pipeline.loading && (
                  <div className="space-y-4 py-2 animate-fade-in">
                    <div className="flex items-center gap-3 text-brand text-sm px-4">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span className="font-medium animate-pulse">Lilit is working...</span>
                    </div>
                    {(pipeline.pipelineSteps.length > 0 || pipeline.tasks.length > 0) && (
                      <PipelineSteps steps={pipeline.pipelineSteps} tasks={pipeline.tasks} className="ml-6" />
                    )}
                    {pipeline.pendingPlan && (
                      <div className="ml-6">
                        <PlanConfirmation
                          projectId={project.id}
                          runId={pipeline.pendingPlan.runId}
                          plan={pipeline.pendingPlan.plan as { analysis: string; tasks: { id: number; title: string; description: string; agent: string; role: string; acceptanceCriteria?: string[]; provider?: string; model?: string }[]; pipeline: string[] }}
                          onConfirmed={pipeline.clearPendingPlan}
                          onRejected={pipeline.clearPendingPlan}
                        />
                      </div>
                    )}
                    {pipeline.pendingQuestion && (
                      <div className="ml-6">
                        <PMQuestionCard
                          question={pipeline.pendingQuestion.question}
                          context={pipeline.pendingQuestion.context}
                          onAnswer={pipeline.answerQuestion}
                        />
                      </div>
                    )}
                    {currentConversationId && (
                      <CostDisplay
                        projectId={project.id}
                        conversationId={currentConversationId}
                        compact
                        className="ml-6"
                      />
                    )}
                  </div>
                )}

                <div ref={scrollRef} />
              </div>
            </ScrollArea>
          </ResizablePanel>

          {showLog && (pipeline.loading || pipeline.logContent) && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={40} minSize={20}>
                {/* Log panel (right side) — polls /api/logs */}
                <div className="flex flex-col h-full min-h-0 bg-background/50">
                  <div className="h-10 glass-subtle flex items-center px-3 gap-2 shrink-0 z-10 border-b border-border-subtle">
                    <span className="text-xs font-medium text-muted-foreground">📋 Activity Log</span>
                    {pipeline.currentAgent && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-brand-soft/50 text-brand-foreground animate-pulse">
                        {pipeline.currentAgent}
                      </Badge>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                       {pipeline.loading && (
                        <div className="flex items-center gap-1.5">
                           <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                            </span>
                            <span className="text-[10px] text-brand font-medium">LIVE</span>
                        </div>
                      )}
                      <Button
                        onClick={() => setUseEnhancedLog(!useEnhancedLog)}
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        title={useEnhancedLog ? "Switch to simple view" : "Switch to enhanced view"}
                      >
                        {useEnhancedLog ? "Simple" : "Enhanced"}
                      </Button>
                    </div>
                  </div>

                  {useEnhancedLog ? (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <EnhancedLogPanel
                        logContent={pipeline.logContent}
                        loading={pipeline.loading}
                        currentAgent={pipeline.currentAgent}
                      />
                    </div>
                  ) : (
                    <pre
                      ref={logRef}
                      className="flex-1 p-3 text-xs text-muted-foreground font-mono overflow-auto bg-black/20 whitespace-pre-wrap break-words min-h-0"
                    >
                      {pipeline.logContent || "Waiting for output..."}
                    </pre>
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Input */}
      <div className="glass-raised border-t border-border/50 p-4 z-20">
        <div className="max-w-3xl mx-auto flex gap-3">
          <Textarea
            placeholder={pipeline.loading ? "Send a message to the running pipeline..." : "Tell Lilit what to build..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            className="bg-surface/50 border-border resize-none min-h-[44px] shadow-inner focus:bg-surface transition-all"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim()}
            className="self-end shadow-md hover:shadow-lg transition-all"
            size="lg"
          >
            Send
          </Button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          projectId={project.id}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Agents Panel */}
      {showAgents && (
        <AgentsPanel onClose={() => setShowAgents(false)} />
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
  let standupMessages: StandupMessageData[] = [];
  let agentMessages: AgentMessageData[] = [];
  let adaptations: Array<{ afterStep: number; reason?: string; addedSteps?: string[]; removedSteps?: number[]; costUsd: number }> = [];
  let debates: Array<{ challengerAgent: string; defenderAgent: string; triggerOpinion: string; outcome: string; turnCount: number; resolutionNote?: string }> = [];
  if (message.metadata) {
    try {
      const meta = JSON.parse(message.metadata);
      steps = meta.steps || [];
      standupMessages = meta.standup?.messages || [];
      agentMessages = meta.agentMessages || [];
      adaptations = meta.adaptations || [];
      debates = meta.debates || [];
    } catch {
      // ignore
    }
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in-up`}>
      <div
        className={`max-w-[85%] rounded-xl px-5 py-4 shadow-sm ${
          isUser
            ? "bg-brand text-white shadow-brand/10 rounded-br-none"
            : isSystem
              ? "bg-destructive-soft text-destructive border border-destructive/20"
              : "glass text-foreground border border-border-subtle rounded-bl-none"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          {!isUser && !isSystem && (
            <div className="flex items-center gap-2">
               <div className="w-4 h-4 rounded-full bg-brand flex items-center justify-center">
                  <span className="text-[10px] text-white">L</span>
               </div>
               <span className="text-xs font-semibold text-foreground">Lilit</span>
            </div>
          )}
          <span className={`text-[10px] ${isUser ? "text-white/70" : "text-muted-foreground"} ml-auto`}>
            {formatMessageTime(message.createdAt)}
          </span>
        </div>
        <div className={`text-sm whitespace-pre-wrap break-words leading-relaxed ${isUser ? "text-white" : ""}`}>{message.content}</div>

        {steps.length > 0 && (
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
        )}

        {adaptations.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border-subtle space-y-2">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pipeline Adaptations:</div>
            {adaptations.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-warning-soft/30 p-2 rounded-md">
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-warning-soft text-warning border-warning/20 shrink-0">
                  Step {a.afterStep + 1}
                </Badge>
                <span className="text-muted-foreground">
                  {a.reason ?? "Pipeline modified"}
                  {a.addedSteps && a.addedSteps.length > 0 && ` (+${a.addedSteps.join(", ")})`}
                </span>
              </div>
            ))}
          </div>
        )}

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
