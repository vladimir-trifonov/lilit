"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVoicePlayback } from "@/lib/use-voice-playback";
import { AGENT } from "@/lib/models";

export interface AgentMessageData {
  id: string;
  fromAgent: string;
  fromRole?: string | null;
  toAgent: string;
  messageType: string;
  content: string;
  phase: number;
  createdAt: string;
}

interface AgentMessageThreadProps {
  messages: AgentMessageData[];
  className?: string;
}

const AGENT_ICONS: Record<string, string> = {
  [AGENT.PM]: "\uD83D\uDCCB",
  [AGENT.ARCHITECT]: "\uD83E\uDDED",
  [AGENT.DEVELOPER]: "\uD83D\uDCBB",
  [AGENT.QA]: "\uD83D\uDEE1\uFE0F",
};

const TYPE_COLORS: Record<string, string> = {
  question: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  flag: "bg-red-500/10 text-red-700 border-red-500/20",
  suggestion: "bg-purple-500/10 text-purple-700 border-purple-500/20",
  handoff: "bg-green-500/10 text-green-700 border-green-500/20",
  response: "bg-zinc-500/10 text-zinc-700 border-zinc-500/20",
};

const TYPE_LABELS: Record<string, string> = {
  question: "Question",
  flag: "Flag",
  suggestion: "Suggestion",
  handoff: "Handoff",
  response: "Response",
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
  const icon = AGENT_ICONS[message.fromAgent] ?? "\uD83E\uDD16";
  const colorClass = TYPE_COLORS[message.messageType] ?? TYPE_COLORS.response;
  const label = TYPE_LABELS[message.messageType] ?? message.messageType;

  return (
    <Card className={`mb-1.5 border-l-2 ${isPlaying ? "border-l-blue-500 bg-blue-500/5" : "border-l-blue-500/30"}`}>
      <CardContent className="p-2.5">
        <div className="flex items-start gap-2">
          <span className={`text-sm mt-0.5 ${isPlaying ? "animate-pulse" : ""}`}>{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span className="font-medium text-xs">{message.fromAgent}</span>
              <span className="text-[10px] text-muted-foreground">&rarr;</span>
              <span className="text-xs">{message.toAgent}</span>
              <Badge
                variant="outline"
                className={`text-[9px] px-1 py-0 ${colorClass}`}
              >
                {label}
              </Badge>
              {onPlay && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-[10px] text-muted-foreground/60 hover:text-foreground"
                  onClick={onPlay}
                  disabled={isLoading}
                  title={isPlaying ? "Playing..." : "Play this message"}
                >
                  {isLoading ? "\u23F3" : isPlaying ? "\u23F8" : "\u25B6"}
                </Button>
              )}
              <span className="text-[9px] text-muted-foreground ml-auto">
                step {message.phase + 1}
              </span>
            </div>
            <p className="text-xs text-foreground/85 whitespace-pre-wrap">
              {message.content}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AgentMessageThread({ messages, className }: AgentMessageThreadProps) {
  const { playingId, loadingId, playingAll, playSingle, playAll, stop } =
    useVoicePlayback(messages, "agent_message");

  if (messages.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Agent Communication
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-5 text-[10px] px-1.5"
          onClick={playingAll ? stop : playAll}
        >
          {playingAll ? "\u23F9 Stop" : "\u25B6 Play All"}
        </Button>
      </div>
      {messages.map((msg) => (
        <AgentMessageCard
          key={msg.id}
          message={msg}
          isPlaying={playingId === msg.id}
          isLoading={loadingId === msg.id}
          onPlay={() => playSingle(msg.id)}
        />
      ))}
    </div>
  );
}
