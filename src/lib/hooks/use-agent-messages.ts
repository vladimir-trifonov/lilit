"use client";

import { useState, useRef, useCallback } from "react";
import { usePolling } from "./use-polling";
import { TEAM_CHAT_POLL_INTERVAL_MS } from "@/lib/constants";
import { apiFetch } from "@/lib/utils";
import type { AgentMessageData } from "@/components/agent-message-thread";

export interface UseAgentMessagesResult {
  messages: AgentMessageData[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadOlderMessages: () => Promise<void>;
}

/**
 * Polls GET /api/messages for real-time agent communications during a pipeline run.
 * Deduplicates by message ID to avoid scroll jumps — appends only new messages.
 * Supports backward pagination via loadOlderMessages().
 * Resets when pipelineRunId changes.
 */
export function useAgentMessages(
  pipelineRunId: string | null,
  enabled: boolean,
): UseAgentMessagesResult {
  const [messages, setMessages] = useState<AgentMessageData[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const seenIdsRef = useRef(new Set<string>());
  const lastTimestampRef = useRef<string | null>(null);
  const oldestTimestampRef = useRef<string | null>(null);
  const activeRunRef = useRef<string | null>(null);

  const resetAndFetch = useCallback(async () => {
    if (!pipelineRunId) return;

    // Detect run change inside the callback (ref access is fine here — event/async context)
    if (pipelineRunId !== activeRunRef.current) {
      activeRunRef.current = pipelineRunId;
      seenIdsRef.current = new Set();
      lastTimestampRef.current = null;
      oldestTimestampRef.current = null;
      setMessages([]);
      setHasMore(false);
    }

    let url = `/api/messages?pipelineRunId=${pipelineRunId}`;
    if (lastTimestampRef.current) {
      url += `&after=${encodeURIComponent(lastTimestampRef.current)}`;
    }

    try {
      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const incoming: AgentMessageData[] = data.messages ?? [];

      const fresh = incoming.filter((m) => !seenIdsRef.current.has(m.id));
      if (fresh.length > 0) {
        for (const m of fresh) {
          seenIdsRef.current.add(m.id);
        }
        lastTimestampRef.current = fresh[fresh.length - 1].createdAt;
        if (!oldestTimestampRef.current) {
          oldestTimestampRef.current = fresh[0].createdAt;
        }
        setMessages((prev) => [...prev, ...fresh]);
      }
    } catch {
      // ignore — next poll will retry
    }
  }, [pipelineRunId]);

  const loadOlderMessages = useCallback(async () => {
    if (!pipelineRunId || !oldestTimestampRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const url = `/api/messages?pipelineRunId=${pipelineRunId}&before=${encodeURIComponent(oldestTimestampRef.current)}`;
      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const older: AgentMessageData[] = data.messages ?? [];

      if (older.length > 0) {
        for (const m of older) {
          seenIdsRef.current.add(m.id);
        }
        oldestTimestampRef.current = older[0].createdAt;
        setMessages((prev) => [...older, ...prev]);
      }
      setHasMore(data.hasMore ?? false);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [pipelineRunId, loadingMore]);

  usePolling(
    resetAndFetch,
    TEAM_CHAT_POLL_INTERVAL_MS,
    enabled && !!pipelineRunId,
  );

  return { messages, total: messages.length, hasMore, loadingMore, loadOlderMessages };
}
