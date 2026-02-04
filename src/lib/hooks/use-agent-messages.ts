"use client";

import { useState, useRef, useCallback } from "react";
import { usePolling } from "./use-polling";
import { TEAM_CHAT_POLL_INTERVAL_MS } from "@/lib/constants";
import { apiFetch } from "@/lib/utils";
import type { AgentMessageData } from "@/components/agent-message-thread";

export interface UseAgentMessagesResult {
  messages: AgentMessageData[];
  total: number;
  unread: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadOlderMessages: () => Promise<void>;
  markRead: () => void;
}

/**
 * Polls GET /api/messages for real-time agent communications.
 * Scoped to a project — messages persist across pipeline runs.
 * Deduplicates by message ID to avoid scroll jumps — appends only new messages.
 * Supports backward pagination via loadOlderMessages().
 */
export function useAgentMessages(
  projectId: string,
  enabled: boolean,
): UseAgentMessagesResult {
  const [messages, setMessages] = useState<AgentMessageData[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const seenIdsRef = useRef(new Set<string>());
  const lastTimestampRef = useRef<string | null>(null);
  const oldestTimestampRef = useRef<string | null>(null);

  const fetchNewMessages = useCallback(async () => {
    if (!projectId) return;

    let url = `/api/messages?projectId=${projectId}`;
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
        setUnread(true);
      }
    } catch {
      // ignore — next poll will retry
    }
  }, [projectId]);

  const loadOlderMessages = useCallback(async () => {
    if (!projectId || !oldestTimestampRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const url = `/api/messages?projectId=${projectId}&before=${encodeURIComponent(oldestTimestampRef.current)}`;
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
  }, [projectId, loadingMore]);

  usePolling(
    fetchNewMessages,
    TEAM_CHAT_POLL_INTERVAL_MS,
    enabled,
  );

  const markRead = useCallback(() => setUnread(false), []);

  return { messages, total: messages.length, unread, hasMore, loadingMore, loadOlderMessages, markRead };
}
