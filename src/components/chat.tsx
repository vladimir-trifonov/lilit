"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { parseLogSteps } from "@/lib/log-parser";
import type { StepInfo } from "@/types/pipeline";

interface Project {
  id: string;
  name: string;
  path: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  metadata?: string;
  createdAt: string;
}

interface ResumableRun {
  runId: string;
  currentStep: number;
  totalSteps: number;
  userMessage: string;
}

export function Chat({ project }: { project: Project }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [logContent, setLogContent] = useState("");
  const [showLog, setShowLog] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [useEnhancedLog, setUseEnhancedLog] = useState(true);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<{ runId: string; plan: unknown } | null>(null);
  const [resumableRun, setResumableRun] = useState<ResumableRun | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const logOffsetRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const planPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse pipeline steps from log content
  const pipelineSteps = useMemo(() => parseLogSteps(logContent), [logContent]);

  // Check pipeline status on mount (detect running/resumable pipelines)
  useEffect(() => {
    let cancelled = false;

    async function checkPipelineStatus() {
      try {
        const res = await fetch(`/api/pipeline?projectId=${project.id}`);
        const data = await res.json();

        if (cancelled) return;

        if (data.status === "running" || data.status === "awaiting_plan") {
          // Reconnect to live pipeline
          setLoading(true);
          setCurrentAgent("pipeline");
          setLogContent("");
          logOffsetRef.current = 0;
        } else if (data.status === "aborted" && data.totalSteps > 0) {
          // Show resume banner
          setResumableRun({
            runId: data.runId,
            currentStep: data.currentStep,
            totalSteps: data.totalSteps,
            userMessage: data.userMessage,
          });
        }
      } catch {
        // ignore
      }
    }

    checkPipelineStatus();
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    const loadMessages = async () => {
      const url = currentConversationId
        ? `/api/chat?conversationId=${currentConversationId}`
        : `/api/chat?projectId=${project.id}`;

      const res = await fetch(url);
      const data = await res.json();

      setMessages(data.messages || []);
      if (data.conversationId) {
        setCurrentConversationId(data.conversationId);
      }
    };

    loadMessages();
  }, [project.id, currentConversationId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logContent]);

  // Poll logs while loading (project-scoped)
  useEffect(() => {
    if (loading) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/logs?projectId=${project.id}&offset=${logOffsetRef.current}`);
          const data = await res.json();
          if (data.log) {
            setLogContent((prev) => prev + data.log);
            logOffsetRef.current = data.offset;
          }
        } catch {
          // ignore
        }
      }, 1500);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      // One final poll to get remaining logs
      fetch(`/api/logs?projectId=${project.id}&offset=${logOffsetRef.current}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.log) setLogContent((prev) => prev + data.log);
        })
        .catch(() => {});
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loading, project.id]);

  // Poll for pending plan while loading (project-scoped)
  useEffect(() => {
    if (loading) {
      planPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/plan?projectId=${project.id}`);
          const data = await res.json();
          if (data.status === "pending" && data.plan) {
            setPendingPlan({ runId: data.runId, plan: data.plan });
          } else {
            setPendingPlan(null);
          }
        } catch {
          // ignore
        }
      }, 2000);
    } else {
      if (planPollRef.current) {
        clearInterval(planPollRef.current);
        planPollRef.current = null;
      }
      setPendingPlan(null);
    }
    return () => {
      if (planPollRef.current) clearInterval(planPollRef.current);
    };
  }, [loading, project.id]);

  const handleAbort = useCallback(async () => {
    try {
      setCurrentAgent("stopping...");
      const res = await fetch("/api/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      if (data.aborted) {
        setLogContent((prev) => prev + "\n\n🛑 Stop signal sent. Pipeline will abort...\n");
      }
    } catch (err) {
      console.error("Abort failed:", err);
      setLogContent((prev) => prev + "\n\n❌ Failed to send stop signal\n");
    }
  }, [project.id]);

  const handleResume = useCallback(async () => {
    if (!resumableRun) return;
    setResumableRun(null);
    setLoading(true);
    setCurrentAgent("pipeline");
    setLogContent("");
    logOffsetRef.current = 0;

    try {
      await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          action: "resume",
          runId: resumableRun.runId,
        }),
      });
    } catch {
      setLoading(false);
      setCurrentAgent(null);
    }
  }, [resumableRun, project.id]);

  const handleRestart = useCallback(async () => {
    if (!resumableRun) return;
    setResumableRun(null);
    setLoading(true);
    setCurrentAgent("pipeline");
    setLogContent("");
    logOffsetRef.current = 0;

    try {
      await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          action: "restart",
          runId: resumableRun.runId,
        }),
      });
    } catch {
      setLoading(false);
      setCurrentAgent(null);
    }
  }, [resumableRun, project.id]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);
    setCurrentAgent("pipeline");
    setLogContent("");
    logOffsetRef.current = 0;
    setResumableRun(null);

    setMessages((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          message: userMessage,
          conversationId: currentConversationId,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "system",
            content: `Error: ${data.error}`,
            createdAt: new Date().toISOString(),
          },
        ]);
      } else {
        const newMsg = {
          id: `asst-${Date.now()}`,
          role: "assistant",
          content: data.response,
          metadata: JSON.stringify({ steps: data.steps }),
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, newMsg]);

        // Set conversation ID for cost tracking
        if (data.conversationId) {
          setCurrentConversationId(data.conversationId);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "system",
          content: "Failed to reach the server",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      setCurrentAgent(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center px-4 gap-3">
        <h2 className="font-medium">{project.name}</h2>
        <span className="text-xs text-muted-foreground">{project.path}</span>
        {/* Project-level cost (always shown) */}
        <CostDisplay projectId={project.id} compact className="ml-4" />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAgents(true)}
            className="text-xs text-zinc-400"
          >
            🤖 Agents
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(true)}
            className="text-xs text-zinc-400"
          >
            ⚙️ Settings
          </Button>
          {(loading || logContent) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLog(!showLog)}
              className="text-xs text-zinc-400"
            >
              {showLog ? "Hide" : "Show"} Log
            </Button>
          )}
          {loading && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleAbort}
              className="text-xs"
            >
              ■ Stop
            </Button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 h-full overflow-hidden">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={showLog && (loading || logContent) ? 60 : 100} minSize={30}>
            {/* Messages */}
            <ScrollArea className="h-full w-full">
              <div className="max-w-3xl mx-auto space-y-4 p-4">
                {messages.length === 0 && !loading && !resumableRun && (
                  <div className="text-center text-muted-foreground py-20">
                    <p className="text-lg mb-1">Start building</p>
                    <p className="text-sm">Tell Lilit what to build.</p>
                  </div>
                )}

                {/* Resume banner */}
                {resumableRun && !loading && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-yellow-400">Pipeline stopped</span>
                      <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-400">
                        Step {resumableRun.currentStep}/{resumableRun.totalSteps}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {resumableRun.userMessage}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button onClick={handleResume} size="sm" className="text-xs">
                        Resume
                      </Button>
                      <Button onClick={handleRestart} variant="outline" size="sm" className="text-xs">
                        Restart
                      </Button>
                      <Button
                        onClick={() => setResumableRun(null)}
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

                {loading && (
                  <div className="space-y-3 py-2">
                    <div className="flex items-center gap-2 text-zinc-500 text-sm">
                      <span className="animate-spin">⟳</span>
                      <span>Pipeline running...</span>
                    </div>
                    {pipelineSteps.length > 0 && (
                      <PipelineSteps steps={pipelineSteps} className="ml-6" />
                    )}
                    {pendingPlan && (
                      <div className="ml-6">
                        <PlanConfirmation
                          projectId={project.id}
                          runId={pendingPlan.runId}
                          plan={pendingPlan.plan as { analysis: string; needsArchitect: boolean; tasks: { id: number; title: string; description: string; agent: string; role: string; acceptanceCriteria?: string[]; provider?: string; model?: string }[]; pipeline: string[] }}
                          onConfirmed={() => setPendingPlan(null)}
                          onRejected={() => setPendingPlan(null)}
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

          {showLog && (loading || logContent) && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={40} minSize={20}>
                {/* Log panel (right side) — polls /api/logs */}
                <div className="flex flex-col h-full min-h-0">
                  <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-background/50 backdrop-blur-sm z-10">
                    <span className="text-xs font-medium text-muted-foreground">📋 Agent Output</span>
                    {currentAgent && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {currentAgent}
                      </Badge>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        onClick={() => setUseEnhancedLog(!useEnhancedLog)}
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        title={useEnhancedLog ? "Switch to simple view" : "Switch to enhanced view"}
                      >
                        {useEnhancedLog ? "Simple" : "Enhanced"}
                      </Button>
                      {loading && (
                        <span className="text-[10px] text-zinc-600 animate-pulse">live</span>
                      )}
                    </div>
                  </div>

                  {useEnhancedLog ? (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <EnhancedLogPanel
                        logContent={logContent}
                        loading={loading}
                        currentAgent={currentAgent}
                      />
                    </div>
                  ) : (
                    <pre
                      ref={logRef}
                      className="flex-1 p-3 text-xs text-muted-foreground font-mono overflow-auto bg-muted/10 whitespace-pre-wrap break-words min-h-0"
                    >
                      {logContent || "Waiting for output..."}
                    </pre>
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Textarea
            placeholder="Tell Lilit what to build..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            className="bg-muted/30 border-input resize-none min-h-[44px]"
            disabled={loading}
          />
          <Button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="self-end"
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  let steps: StepInfo[] = [];
  if (message.metadata) {
    try {
      const meta = JSON.parse(message.metadata);
      steps = meta.steps || [];
    } catch {
      // ignore
    }
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 ${
          isUser
            ? "bg-primary text-primary-foreground shadow-sm"
            : isSystem
              ? "bg-destructive/10 text-destructive border border-destructive/20"
              : "bg-surface text-surface-foreground border border-border/50"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          {!isUser && !isSystem && (
            <span className="text-xs text-muted-foreground font-medium">Lilit</span>
          )}
          <span className={`text-[10px] ${isUser ? "text-primary-foreground/60" : "text-muted-foreground/60"} ml-auto`}>
            {formatMessageTime(message.createdAt)}
          </span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>

        {steps.length > 0 && (
          <div className="mt-3 pt-2 border-t border-zinc-700 space-y-1">
            <div className="text-xs text-zinc-500 font-medium">Pipeline:</div>
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Badge
                  variant={s.status === "done" ? "default" : "destructive"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {s.role ? `${s.agent}:${s.role}` : s.agent}
                </Badge>
                <span className="text-zinc-400">{s.title}</span>
                <span>{s.status === "done" ? "✅" : "❌"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
