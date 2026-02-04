"use client";

import { useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentMessages } from "@/lib/hooks/use-agent-messages";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { getAgentIcon, getAgentColor } from "@/lib/agent-style";
import {
  TEAM_CHAT_STATE_KEY,
  TEAM_CHAT_DEFAULT_WIDTH,
  TEAM_CHAT_DEFAULT_HEIGHT,
  TEAM_CHAT_MIN_WIDTH,
  TEAM_CHAT_MIN_HEIGHT,
  TEAM_CHAT_MAX_WIDTH,
  TEAM_CHAT_MAX_HEIGHT,
} from "@/lib/constants";

const TYPE_COLORS: Record<string, string> = {
  question: "bg-info-soft text-info",
  flag: "bg-destructive-soft text-destructive",
  suggestion: "bg-accent-soft text-accent",
  handoff: "bg-success-soft text-success",
  response: "bg-muted text-muted-foreground",
  challenge: "bg-destructive-soft text-destructive",
  counter: "bg-info-soft text-info",
  concede: "bg-success-soft text-success",
  escalate: "bg-warning-soft text-warning",
  moderate: "bg-brand-soft text-brand",
};

const TYPE_LABELS: Record<string, string> = {
  question: "Question",
  flag: "Flag",
  suggestion: "Suggestion",
  handoff: "Handoff",
  response: "Response",
  challenge: "Challenge",
  counter: "Counter",
  concede: "Concede",
  escalate: "Escalate",
  moderate: "Moderate",
};

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
}

const DEFAULT_STATE: WindowState = {
  x: -1,
  y: -1,
  width: TEAM_CHAT_DEFAULT_WIDTH,
  height: TEAM_CHAT_DEFAULT_HEIGHT,
  minimized: true,
};

interface TeamChatWindowProps {
  projectId: string;
  pipelineLoading: boolean;
  isFocused?: boolean;
  onFocus?: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function TeamChatWindow({ projectId, pipelineLoading, isFocused, onFocus }: TeamChatWindowProps) {
  const [windowState, setWindowState] = useLocalStorageState<WindowState>(TEAM_CHAT_STATE_KEY, DEFAULT_STATE);
  const prevLoadingRef = useRef(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const autoExpandArmedRef = useRef(false);
  const isMounted = typeof window !== "undefined";

  const { messages, unread, hasMore, loadingMore, loadOlderMessages, markRead } = useAgentMessages(projectId, true);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);

  // Arm auto-expand when a new pipeline run starts
  useEffect(() => {
    if (pipelineLoading && !prevLoadingRef.current) {
      autoExpandArmedRef.current = true;
    }
    prevLoadingRef.current = pipelineLoading;
  }, [pipelineLoading]);

  // Auto-expand once per run when first message arrives
  useEffect(() => {
    if (
      autoExpandArmedRef.current &&
      windowState.minimized &&
      pipelineLoading &&
      messages.length > 0
    ) {
      autoExpandArmedRef.current = false;
      setWindowState((prev) => ({ ...prev, minimized: false }));
      markRead();
    }
  }, [messages.length, pipelineLoading, windowState.minimized, setWindowState, markRead]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!windowState.minimized) {
      scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
      markRead();
    }
  }, [messages.length, windowState.minimized, markRead]);

  // Upward infinite scroll for older messages
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel || windowState.minimized) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          const container = messageContainerRef.current;
          const prevHeight = container?.scrollHeight ?? 0;
          loadOlderMessages().then(() => {
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
  }, [hasMore, loadingMore, loadOlderMessages, windowState.minimized]);

  // Initialize position to bottom-right on first render
  useEffect(() => {
    if (windowState.x === -1 && windowState.y === -1) {
      setWindowState((prev) => ({
        ...prev,
        x: window.innerWidth - prev.width - 24,
        y: window.innerHeight - prev.height - 100,
      }));
    }
  }, [windowState.x, windowState.y, setWindowState]);

  const handleMinimize = useCallback(() => {
    setWindowState((prev) => ({ ...prev, minimized: true }));
  }, [setWindowState]);

  const handleExpand = useCallback(() => {
    setWindowState((prev) => ({ ...prev, minimized: false }));
    markRead();
  }, [setWindowState, markRead]);

  // Minimized pill
  if (windowState.minimized) {
    const circleColor = unread
      ? "bg-brand"
      : pipelineLoading
        ? "bg-success"
        : "bg-muted-foreground/50";

    const minimized = (
      <button
        onClick={handleExpand}
        onFocus={onFocus}
        className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-2 bg-surface-raised border rounded-full shadow-lg shadow-black/10 hover:shadow-xl transition-all duration-300 cursor-pointer ${isFocused ? "border-brand ring-1 ring-brand/50 scale-105" : "border-border"}`}
      >
        <span className="relative flex h-2.5 w-2.5">
          {unread && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 transition-colors duration-300 ${circleColor}`} />
        </span>
        <span className="text-xs font-medium text-foreground">Team Chat</span>
      </button>
    );

    if (!isMounted) return null;
    return createPortal(minimized, document.body);
  }

  // Unique agents for color dots
  const uniqueAgents = [...new Set(messages.map((m) => m.fromAgent))];

  const expanded = (
    <Rnd
      position={{ x: windowState.x, y: windowState.y }}
      size={{ width: windowState.width, height: windowState.height }}
      minWidth={TEAM_CHAT_MIN_WIDTH}
      minHeight={TEAM_CHAT_MIN_HEIGHT}
      maxWidth={TEAM_CHAT_MAX_WIDTH}
      maxHeight={TEAM_CHAT_MAX_HEIGHT}
      bounds="window"
      dragHandleClassName="team-chat-drag-handle"
      onDragStart={(_e, d) => {
        onFocus?.();
      }}
      onDragStop={(_e, d) => {
        setWindowState((prev) => ({ ...prev, x: d.x, y: d.y }));
      }}
      onResizeStart={() => onFocus?.()}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        setWindowState((prev) => ({
          ...prev,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
          x: pos.x,
          y: pos.y,
        }));
      }}
      style={{ position: "fixed" }}
      className={`bg-surface-raised border rounded-xl shadow-2xl shadow-black/20 flex flex-col overflow-hidden select-none ${isFocused ? "z-[10000] border-border opacity-100" : "z-[101] border-border opacity-90 hover:opacity-100"}`}
      onMouseDownCapture={() => onFocus?.()}
    >
      {/* Title bar — drag handle */}
      <div className="team-chat-drag-handle flex items-center gap-2.5 h-11 px-3.5 border-b border-border-subtle cursor-grab active:cursor-grabbing shrink-0 glass-subtle sticky top-0 z-20">
        {/* Agent color dots */}
        <div className="flex items-center gap-1">
          {uniqueAgents.slice(0, 4).map((agent) => (
            <div
              key={agent}
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: getAgentColor(agent) }}
              title={agent}
            />
          ))}
        </div>

        <span className="text-xs font-medium text-foreground">Team Chat</span>
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 text-muted-foreground">
          {messages.length}
        </Badge>

        {/* LIVE indicator */}
        {pipelineLoading && (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand" />
            </span>
            <span className="text-[10px] text-brand font-medium">LIVE</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Minimize */}
          <button
            onClick={handleMinimize}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
            title="Minimize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Message list */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={messageContainerRef} className="p-3 space-y-2">
          <div ref={topSentinelRef} className="h-px" />
          {loadingMore && (
            <div className="flex items-center justify-center py-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <span className="ml-1.5 text-[10px] text-muted-foreground">Loading older messages...</span>
            </div>
          )}
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              {pipelineLoading ? "Waiting for agent messages..." : "No messages yet"}
            </div>
          )}
          {messages.map((msg) => {
            const icon = getAgentIcon(msg.fromAgent);
            const colorClass = TYPE_COLORS[msg.messageType] ?? TYPE_COLORS.response;
            const label = TYPE_LABELS[msg.messageType] ?? msg.messageType;

            return (
              <div
                key={msg.id}
                className="rounded-lg bg-card/50 hover:bg-surface-raised/50 transition-colors p-2.5"
                style={{ borderLeft: `2px solid ${getAgentColor(msg.fromAgent)}` }}
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm">{icon}</span>
                  <span className="font-semibold text-[11px] text-foreground">{msg.fromAgent}</span>
                  <span className="text-[10px] text-muted-foreground">&rarr;</span>
                  <span className="text-[11px] text-foreground">{msg.toAgent}</span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 h-4 border ${colorClass}`}
                  >
                    {label}
                  </Badge>
                  <span className="text-[9px] text-faint ml-auto">
                    {formatRelativeTime(msg.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap pl-6">
                  {msg.content}
                </p>
              </div>
            );
          })}
          <div ref={scrollEndRef} />
        </div>
      </ScrollArea>
    </Rnd>
  );

  if (!isMounted) return null;
  return createPortal(expanded, document.body);
}
