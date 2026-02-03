"use client";

import { Button } from "@/components/ui/button";

export function PlaybackButton({
  isPlaying,
  isLoading,
  onPlay,
}: {
  isPlaying: boolean;
  isLoading: boolean;
  onPlay: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-5 w-5 p-0 text-[10px] text-muted-foreground/60 hover:text-foreground ml-1"
      onClick={onPlay}
      disabled={isLoading}
      title={isPlaying ? "Playing..." : "Play this message"}
    >
      {isLoading ? "\u23F3" : isPlaying ? "\u23F8" : "\u25B6"}
    </Button>
  );
}
