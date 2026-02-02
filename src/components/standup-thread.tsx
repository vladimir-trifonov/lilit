"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVoicePlayback } from "@/lib/use-voice-playback";
import { AGENT } from "@/lib/models";

export interface StandupMessageData {
  id?: string;
  fromAgent: string;
  fromCodename: string;
  fromRole?: string;
  toAgent: string;
  toCodename: string;
  insightType: string;
  message: string;
  actionable: boolean;
  feedback?: string | null;
}

export interface StandupTrend {
  theme: string;
  insightType: string;
  occurrences: number;
  lastSeenAt: string;
  resolved: boolean;
}

interface StandupThreadProps {
  messages: StandupMessageData[];
  trends?: StandupTrend[];
  className?: string;
}

const AGENT_ICONS: Record<string, string> = {
  [AGENT.PM]: "\uD83D\uDCCB",
  [AGENT.ARCHITECT]: "\uD83E\uDDED",
  [AGENT.DEVELOPER]: "\uD83D\uDCBB",
  [AGENT.QA]: "\uD83D\uDEE1\uFE0F",
};

const INSIGHT_COLORS: Record<string, string> = {
  "cross-concern": "bg-amber-500/10 text-amber-700 border-amber-500/20",
  pattern: "bg-purple-500/10 text-purple-700 border-purple-500/20",
  process: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  drift: "bg-red-500/10 text-red-700 border-red-500/20",
  risk: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  none: "bg-muted text-muted-foreground border-muted",
};

const INSIGHT_LABELS: Record<string, string> = {
  "cross-concern": "Cross-Concern",
  pattern: "Pattern",
  process: "Process",
  drift: "Drift",
  risk: "Risk",
  none: "No Tension",
};

// ---- Feedback buttons ----

function FeedbackButtons({ messageId, initialFeedback }: { messageId: string; initialFeedback?: string | null }) {
  const [feedback, setFeedback] = useState<string | null>(initialFeedback ?? null);
  const [saving, setSaving] = useState(false);

  async function sendFeedback(value: "useful" | "not_useful") {
    if (saving) return;
    const newValue = feedback === value ? null : value;
    setSaving(true);
    try {
      await fetch("/api/standups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, feedback: newValue }),
      });
      setFeedback(newValue);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1 ml-auto">
      <Button
        variant="ghost"
        size="sm"
        className={`h-5 w-5 p-0 text-[10px] ${feedback === "useful" ? "text-green-500" : "text-muted-foreground/40 hover:text-green-500"}`}
        onClick={() => sendFeedback("useful")}
        disabled={saving}
        title="Useful insight"
      >
        &#9650;
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-5 w-5 p-0 text-[10px] ${feedback === "not_useful" ? "text-red-500" : "text-muted-foreground/40 hover:text-red-500"}`}
        onClick={() => sendFeedback("not_useful")}
        disabled={saving}
        title="Not useful"
      >
        &#9660;
      </Button>
    </div>
  );
}

// ---- Message card ----

function StandupMessageCard({
  message,
  isPlaying,
  isLoading,
  onPlay,
}: {
  message: StandupMessageData;
  isPlaying: boolean;
  isLoading: boolean;
  onPlay?: () => void;
}) {
  const icon = AGENT_ICONS[message.fromAgent] ?? "\uD83E\uDD16";
  const colorClass = INSIGHT_COLORS[message.insightType] ?? INSIGHT_COLORS.none;
  const label = INSIGHT_LABELS[message.insightType] ?? message.insightType;

  return (
    <Card className={`mb-2 border-l-2 ${isPlaying ? "border-l-primary bg-primary/5" : "border-l-primary/30"}`}>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <span className={`text-lg mt-0.5 ${isPlaying ? "animate-pulse" : ""}`}>{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-medium text-sm">
                {message.fromCodename}
              </span>
              <span className="text-xs text-muted-foreground">
                ({message.fromAgent})
              </span>
              {message.toAgent !== "none" && (
                <>
                  <span className="text-xs text-muted-foreground">
                    &rarr;
                  </span>
                  <span className="text-sm">
                    {message.toCodename}
                  </span>
                </>
              )}
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${colorClass}`}
              >
                {label}
              </Badge>
              {message.actionable && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 bg-yellow-500/10 text-yellow-700 border-yellow-500/20"
                >
                  Actionable
                </Badge>
              )}
              {message.id && onPlay && (
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
              {message.id && (
                <FeedbackButtons messageId={message.id} initialFeedback={message.feedback} />
              )}
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">
              {message.message}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Trends summary ----

function TrendsSummary({ trends }: { trends: StandupTrend[] }) {
  if (trends.length === 0) return null;

  const unresolved = trends.filter((t) => !t.resolved);
  if (unresolved.length === 0) return null;

  return (
    <div className="mb-3 p-2 rounded-lg bg-muted/50 border border-border/30">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">
        Recurring Themes ({unresolved.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {unresolved.slice(0, 5).map((trend, i) => {
          const colorClass = INSIGHT_COLORS[trend.insightType] ?? INSIGHT_COLORS.none;
          return (
            <Badge
              key={i}
              variant="outline"
              className={`text-[10px] px-1.5 py-0.5 ${colorClass}`}
            >
              {trend.theme} ({trend.occurrences}x)
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

// ---- Main component ----

export function StandupThread({ messages, trends, className }: StandupThreadProps) {
  const insights = messages.filter((m) => m.insightType !== "none");
  const noTensions = messages.filter((m) => m.insightType === "none");
  const hasVoiceMessages = insights.some((m) => m.id);

  const { playingId, loadingId, playingAll, playSingle, playAll, stop } =
    useVoicePlayback(insights, "standup");

  if (messages.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium">
          Team Standup
        </span>
        {insights.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {insights.length} insight{insights.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {noTensions.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {noTensions.length} agent{noTensions.length !== 1 ? "s" : ""} reported no tensions
          </span>
        )}
        {hasVoiceMessages && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-6 text-[11px] px-2"
            onClick={playingAll ? stop : playAll}
          >
            {playingAll ? "\u23F9 Stop" : "\u25B6 Play Standup"}
          </Button>
        )}
      </div>

      {trends && <TrendsSummary trends={trends} />}

      {insights.map((msg, i) => (
        <StandupMessageCard
          key={msg.id ?? i}
          message={msg}
          isPlaying={playingId === msg.id}
          isLoading={loadingId === msg.id}
          onPlay={msg.id ? () => playSingle(msg.id!) : undefined}
        />
      ))}

      {noTensions.length > 0 && insights.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 pl-1">
          {noTensions.map((m) => m.fromCodename).join(", ")} reported no tensions.
        </p>
      )}

      {insights.length === 0 && (
        <p className="text-xs text-muted-foreground mt-1 pl-1">
          All agents reported no tensions. Clean pipeline run.
        </p>
      )}
    </div>
  );
}
