"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaybackButton } from "@/components/playback-button";
import { useVoicePlayback } from "@/lib/hooks/use-voice-playback";
import { getAgentIcon } from "@/lib/agent-style";

export interface AgentMessageData {
  id: string;
  fromAgent: string;
  fromRole?: string | null;
  toAgent: string;
  messageType: string;
  content: string;
  phase: number;
  createdAt: string;
  debateId?: string | null;
  debateRole?: string | null;
}

interface AgentMessageThreadProps {
  messages: AgentMessageData[];
  className?: string;
}


const TYPE_COLORS: Record<string, string> = {
  question: "bg-info-soft text-info border-info/20",
  flag: "bg-destructive-soft text-destructive border-destructive/20",
  suggestion: "bg-accent-soft text-accent border-accent/20",
  handoff: "bg-success-soft text-success border-success/20",
  response: "bg-muted text-muted-foreground border-border",
  // Debate message types
  challenge: "bg-destructive-soft text-destructive border-destructive/20",
  counter: "bg-info-soft text-info border-info/20",
  concede: "bg-success-soft text-success border-success/20",
  escalate: "bg-warning-soft text-warning border-warning/20",
  moderate: "bg-brand-soft text-brand border-brand/20",
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

function AgentMessageCard({
  message,
  isPlaying,
  isLoading,
  onPlay,
}: {
  message: AgentMessageData;
  isPlaying: boolean;
  isLoading: boolean;
  onPlay?: () => void;
}) {
  const icon = getAgentIcon(message.fromAgent);
  const colorClass = TYPE_COLORS[message.messageType] ?? TYPE_COLORS.response;
  const label = TYPE_LABELS[message.messageType] ?? message.messageType;

  return (
    <div className={`mb-2 rounded-lg border-l-2 p-3 ${isPlaying ? "bg-surface-raised border-brand/50" : "bg-card border-border-subtle"} hover:bg-surface-raised/50 transition-colors`}>
      <div className="flex items-start gap-3">
        <span className={`text-base mt-0.5 ${isPlaying ? "animate-pulse" : ""}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-xs text-foreground">{message.fromAgent}</span>
            <span className="text-[10px] text-muted-foreground">&rarr;</span>
            <span className="text-xs text-foreground">{message.toAgent}</span>
            <Badge
              variant="outline"
              className={`text-[9px] px-1.5 py-0 h-4 border ${colorClass}`}
            >
              {label}
            </Badge>
            {onPlay && (
              <PlaybackButton isPlaying={isPlaying} isLoading={isLoading} onPlay={onPlay} />
            )}
            <span className="text-[9px] text-faint ml-auto">
              step {message.phase + 1}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Group messages into regular messages and debate groups for visual clustering. */
type MessageGroup = { type: "regular"; message: AgentMessageData } | { type: "debate"; debateId: string; messages: AgentMessageData[] };

function groupMessages(messages: AgentMessageData[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  const debateMap = new Map<string, AgentMessageData[]>();
  const seenDebates = new Set<string>();

  for (const msg of messages) {
    if (msg.debateId) {
      if (!debateMap.has(msg.debateId)) {
        debateMap.set(msg.debateId, []);
      }
      debateMap.get(msg.debateId)!.push(msg);

      // Insert placeholder at position of first message in this debate
      if (!seenDebates.has(msg.debateId)) {
        seenDebates.add(msg.debateId);
        groups.push({ type: "debate", debateId: msg.debateId, messages: debateMap.get(msg.debateId)! });
      }
    } else {
      groups.push({ type: "regular", message: msg });
    }
  }

  return groups;
}

export function AgentMessageThread({ messages, className }: AgentMessageThreadProps) {
  const { playingId, loadingId, playingAll, playSingle, playAll, stop } =
    useVoicePlayback(messages, "agent_message");

  if (messages.length === 0) return null;

  const debateCount = new Set(messages.filter((m) => m.debateId).map((m) => m.debateId)).size;
  const grouped = groupMessages(messages);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Agent Communication
        </span>
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 text-muted-foreground">
          {messages.length}
        </Badge>
        {debateCount > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-destructive border-destructive/30">
            {debateCount} debate{debateCount > 1 ? "s" : ""}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 text-[10px] px-2 hover:bg-surface-raised"
          onClick={playingAll ? stop : playAll}
        >
          {playingAll ? "\u23F9 Stop" : "\u25B6 Play All"}
        </Button>
      </div>
      <div className="space-y-1">
        {grouped.map((group) => {
          if (group.type === "regular") {
            return (
              <AgentMessageCard
                key={group.message.id}
                message={group.message}
                isPlaying={playingId === group.message.id}
                isLoading={loadingId === group.message.id}
                onPlay={() => playSingle(group.message.id)}
              />
            );
          }

          // Debate group — visually clustered
          return (
            <div
              key={group.debateId}
              className="rounded-lg border border-destructive/20 bg-destructive-soft/30 p-2 space-y-1"
            >
              <div className="flex items-center gap-2 px-1 mb-1">
                <span className="text-[10px] font-semibold text-destructive uppercase tracking-wider">
                  Debate
                </span>
              </div>
              {group.messages.map((msg, idx) => (
                <div key={msg.id} className={idx > 0 ? "ml-4" : ""}>
                  <AgentMessageCard
                    message={msg}
                    isPlaying={playingId === msg.id}
                    isLoading={loadingId === msg.id}
                    onPlay={() => playSingle(msg.id)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
