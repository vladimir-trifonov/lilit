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
import { ConversationSelector } from "@/components/conversation-selector";
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

export function Chat({ project }: { project: Project }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [logContent, setLogContent] = useState("");
  const [showLog, setShowLog] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const [useEnhancedLog, setUseEnhancedLog] = useState(true);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const logOffsetRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse pipeline steps from log content
  const pipelineSteps = useMemo(() => parseLogSteps(logContent), [logContent]);

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

  // Poll logs while loading
  useEffect(() => {
    if (loading) {
      logOffsetRef.current = 0;
      setLogContent("");
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/logs?offset=${logOffsetRef.current}`);
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
      fetch(`/api/logs?offset=${logOffsetRef.current}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.log) setLogContent((prev) => prev + data.log);
        })
        .catch(() => {});
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loading]);

  const handleAbort = useCallback(async () => {
    try {
      setCurrentAgent("stopping...");
      const res = await fetch("/api/abort", { method: "POST" });
      const data = await res.json();
      if (data.aborted) {
        setLogContent((prev) => prev + "\n\n🛑 Stop signal sent. Pipeline will abort...\n");
      }
    } catch (err) {
      console.error("Abort failed:", err);
      setLogContent((prev) => prev + "\n\n❌ Failed to send stop signal\n");
    }
  }, []);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);
    setCurrentAgent("pipeline");
    setLogContent("");
    setCurrentConversationId(null); // Will be set from response

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
        body: JSON.stringify({ projectId: project.id, message: userMessage }),
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
            onClick={() => setShowConversations(!showConversations)}
            className="text-xs text-zinc-400"
          >
            💬 History
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
      <div className="flex-1 flex min-h-0">
        {/* Messages */}
        <ScrollArea className={`p-4 ${showLog && (loading || logContent) ? "w-1/2" : "w-full"}`}>
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && !loading && (
              <div className="text-center text-muted-foreground py-20">
                <p className="text-lg mb-1">Start building</p>
                <p className="text-sm">Tell the crew what to build.</p>
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

        {/* Log panel (right side) — polls /api/logs */}
        {showLog && (loading || logContent) && (
          <div className="w-1/2 border-l border-border flex flex-col min-h-0">
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
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
              <EnhancedLogPanel
                logContent={logContent}
                loading={loading}
                currentAgent={currentAgent}
              />
            ) : (
              <pre
                ref={logRef}
                className="flex-1 p-3 text-xs text-muted-foreground font-mono overflow-auto bg-muted/10 whitespace-pre-wrap break-words"
              >
                {logContent || "Waiting for output..."}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Textarea
            placeholder="Tell the crew what to build..."
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

      {/* Conversation History Panel */}
      {showConversations && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-end z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-80 h-[600px] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-zinc-800">
              <h2 className="text-sm font-medium">Conversation History</h2>
              <Button
                onClick={() => setShowConversations(false)}
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
              >
                Close
              </Button>
            </div>
            <ConversationSelector
              projectId={project.id}
              currentConversationId={currentConversationId}
              onSelect={(convId) => {
                setCurrentConversationId(convId);
                setShowConversations(false);
              }}
              onNewConversation={() => {
                setCurrentConversationId(null);
                setMessages([]);
                setShowConversations(false);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
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
              : "bg-secondary text-secondary-foreground"
        }`}
      >
        {!isUser && !isSystem && (
          <div className="text-xs text-muted-foreground mb-1 font-medium">Crew</div>
        )}
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>

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
