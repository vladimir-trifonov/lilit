/**
 * Conversation selector component
 * Shows list of conversations with timestamps and message counts
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

interface ConversationSelectorProps {
  projectId: string;
  currentConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  className?: string;
}

export function ConversationSelector({
  projectId,
  currentConversationId,
  onSelect,
  onNewConversation,
  className = "",
}: ConversationSelectorProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConversations = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/conversations?projectId=${projectId}`);
        if (res.ok) {
          const data = await res.json();
          setConversations(data);
        }
      } catch (err) {
        console.error("Failed to fetch conversations:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();
  }, [projectId]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  if (loading) {
    return (
      <div className={`p-4 text-center text-zinc-500 text-xs ${className}`}>
        <div className="animate-spin">⟳</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="p-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-zinc-400">Conversations</span>
          <Badge variant="outline" className="text-[10px]">
            {conversations.length}
          </Badge>
        </div>
        <Button
          onClick={onNewConversation}
          variant="outline"
          size="sm"
          className="w-full text-xs"
        >
          + New Conversation
        </Button>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center text-zinc-600 text-xs py-8">
              No conversations yet
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  currentConversationId === conv.id
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-xs text-zinc-500">
                    {formatDate(conv.updatedAt)}
                  </span>
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">
                    {conv.messageCount}
                  </Badge>
                </div>
                <div className="text-xs line-clamp-2">{conv.preview}</div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
