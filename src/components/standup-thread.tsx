"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaybackButton } from "@/components/playback-button";
import { useVoicePlayback } from "@/lib/hooks/use-voice-playback";
import { getAgentIcon } from "@/lib/agent-style";
import { apiFetch } from "@/lib/utils";

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

const INSIGHT_COLORS: Record<string, string> = {
  "cross-concern": "bg-warning-soft text-warning border-warning/20",
  pattern: "bg-info-soft text-info border-info/20",
  process: "bg-accent-soft text-accent border-accent/20",
  drift: "bg-destructive-soft text-destructive border-destructive/20",
  risk: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "debate-follow-up": "bg-destructive-soft text-destructive border-destructive/20",
  none: "bg-muted text-muted-foreground border-muted",
};

const INSIGHT_LABELS: Record<string, string> = {
  "cross-concern": "Cross-Concern",
  "debate-follow-up": "Debate Follow-up",
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

  useEffect(() => {
    setFeedback(initialFeedback ?? null);
  }, [initialFeedback]);

  async function sendFeedback(value: "useful" | "not_useful") {
    if (saving) return;
    const newValue = feedback === value ? null : value;
    setSaving(true);
    try {
      const res = await apiFetch("/api/standups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, feedback: newValue }),
      });
      if (res.ok) {
        setFeedback(newValue);
      }
    } catch {
      // network failure — keep previous state
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1 ml-auto">
      <Button
        variant="ghost"
        size="sm"
        className={`h-5 w-5 p-0 text-[10px] ${feedback === "useful" ? "text-success" : "text-muted-foreground/40 hover:text-success"}`}
        onClick={() => sendFeedback("useful")}
        disabled={saving}
        title="Useful insight"
      >
        &#9650;
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-5 w-5 p-0 text-[10px] ${feedback === "not_useful" ? "text-destructive" : "text-muted-foreground/40 hover:text-destructive"}`}
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
  const icon = getAgentIcon(message.fromAgent);
  const colorClass = INSIGHT_COLORS[message.insightType] ?? INSIGHT_COLORS.none;
  const label = INSIGHT_LABELS[message.insightType] ?? message.insightType;

  return (
    <div className={`mb-2 rounded-lg border-l-2 p-3 ${isPlaying ? "bg-brand-soft/20 border-brand" : "bg-card border-border-subtle"} hover:bg-surface-raised/50 transition-colors`}>
      <div className="flex items-start gap-3">
        <span className={`text-base mt-0.5 ${isPlaying ? "animate-pulse" : ""}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-xs text-foreground">
              {message.fromCodename}
            </span>
            <span className="text-[10px] text-muted-foreground">
              ({message.fromAgent})
            </span>
            {message.toAgent !== "none" && (
              <>
                <span className="text-[10px] text-muted-foreground">
                  &rarr;
                </span>
                <span className="text-xs text-foreground">
                  {message.toCodename}
                </span>
              </>
            )}
            <Badge
              variant="outline"
              className={`text-[9px] px-1.5 py-0 h-4 border ${colorClass}`}
            >
              {label}
            </Badge>
            {message.actionable && (
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 h-4 bg-warning-soft text-warning border-warning/20"
              >
                Actionable
              </Badge>
            )}
            {message.id && onPlay && (
              <PlaybackButton isPlaying={isPlaying} isLoading={isLoading} onPlay={onPlay} />
            )}
            {message.id && (
              <FeedbackButtons messageId={message.id} initialFeedback={message.feedback} />
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {message.message}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Trends summary ----

function TrendsSummary({ trends }: { trends: StandupTrend[] }) {
  if (trends.length === 0) return null;

  const unresolved = trends.filter((t) => !t.resolved);
  if (unresolved.length === 0) return null;

  return (
    <div className="mb-3 p-3 rounded-lg bg-surface border border-border-subtle">
      <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
        Recurring Themes ({unresolved.length})
      </div>
      <div className="flex flex-wrap gap-2">
        {unresolved.slice(0, 5).map((trend) => {
          const colorClass = INSIGHT_COLORS[trend.insightType] ?? INSIGHT_COLORS.none;
          return (
            <Badge
              key={`${trend.theme}-${trend.insightType}`}
              variant="outline"
              className={`text-[9px] px-2 py-0.5 h-5 border ${colorClass}`}
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
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Team Standup
        </span>
        {insights.length > 0 && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 text-muted-foreground">
            {insights.length} insight{insights.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {noTensions.length > 0 && (
          <span className="text-[10px] text-faint ml-2">
            {noTensions.length} reported clean
          </span>
        )}
        {hasVoiceMessages && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-6 text-[10px] px-2 hover:bg-surface-raised"
            onClick={playingAll ? stop : playAll}
          >
            {playingAll ? "\u23F9 Stop" : "\u25B6 Play Standup"}
          </Button>
        )}
      </div>

      {trends && <TrendsSummary trends={trends} />}

      <div className="space-y-1">
        {insights.map((msg, i) => (
          <StandupMessageCard
            key={msg.id ?? i}
            message={msg}
            isPlaying={playingId === msg.id}
            isLoading={loadingId === msg.id}
            onPlay={msg.id ? () => playSingle(msg.id!) : undefined}
          />
        ))}
      </div>

      {noTensions.length > 0 && insights.length > 0 && (
        <p className="text-[10px] text-faint mt-2 pl-1 italic">
          {noTensions.map((m) => m.fromCodename).join(", ")} reported no tensions.
        </p>
      )}

      {insights.length === 0 && (
        <div className="p-4 rounded-lg border border-dashed border-border-subtle text-center">
          <p className="text-xs text-muted-foreground">
            All agents reported no tensions. Clean pipeline run. ✨
          </p>
        </div>
      )}
    </div>
  );
}
