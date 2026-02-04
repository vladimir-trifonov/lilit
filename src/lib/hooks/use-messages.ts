"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/utils";

interface Message {
  id: string;
  role: string;
  content: string;
  metadata?: string;
  createdAt: string;
}

export interface UseMessagesResult {
  messages: Message[];
  currentConversationId: string | null;
  input: string;
  setInput: (v: string) => void;
  handleSend: () => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}

interface UseMessagesOptions {
  projectId: string;
  /** Called before the API request — use to start pipeline polling */
  onSendStart: () => void;
  /** Called when the response is received (success or error) */
  onSendEnd: () => void;
}

/**
 * Manages chat messages, conversation tracking, and message submission.
 * Supports cursor-based pagination for loading older messages.
 */
export function useMessages({
  projectId,
  onSendStart,
  onSendEnd,
}: UseMessagesOptions): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const onSendStartRef = useRef(onSendStart);
  const onSendEndRef = useRef(onSendEnd);
  onSendStartRef.current = onSendStart;
  onSendEndRef.current = onSendEnd;

  // Load messages on mount / conversation change
  useEffect(() => {
    const loadMessages = async () => {
      const url = currentConversationId
        ? `/api/chat?conversationId=${currentConversationId}`
        : `/api/chat?projectId=${projectId}`;

      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = await res.json();

      setMessages(data.messages || []);
      setHasMore(data.hasMore ?? false);
      nextCursorRef.current = data.nextCursor ?? null;
      if (data.conversationId) {
        setCurrentConversationId(data.conversationId);
      }
    };

    loadMessages();
  }, [projectId, currentConversationId]);

  // Load older messages (prepend)
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursorRef.current || !currentConversationId) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch(
        `/api/chat?conversationId=${currentConversationId}&cursor=${encodeURIComponent(nextCursorRef.current)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const older: Message[] = data.messages || [];
      if (older.length > 0) {
        setMessages((prev) => [...older, ...prev]);
      }
      setHasMore(data.hasMore ?? false);
      nextCursorRef.current = data.nextCursor ?? null;
    } catch {
      // ignore — user can retry
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, currentConversationId]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput("");
    onSendStartRef.current();

    // Optimistic user message
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
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          message: userMessage,
          conversationId: currentConversationId,
        }),
      });

      const data = await res.json();

      if (data.status === "message_queued") {
        // Message queued for running pipeline — no assistant response expected
        if (data.conversationId) {
          setCurrentConversationId(data.conversationId);
        }
      } else if (data.error) {
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
          metadata: JSON.stringify({
            steps: data.steps,
            agentMessages: data.agentMessages,
          }),
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, newMsg]);

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
      onSendEndRef.current();
    }
  }, [input, projectId, currentConversationId]);

  return { messages, currentConversationId, input, setInput, handleSend, hasMore, loadingMore, loadMore };
}
