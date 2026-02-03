"use client";

import { useState, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/utils";

export interface VoicePlayableMessage {
  id?: string;
}

/**
 * Shared voice playback hook for both StandupThread and AgentMessageThread.
 *
 * @param messages Array of messages with optional `id` field
 * @param sourceType "standup" or "agent_message" — passed to /api/voice/generate
 * @param filter Optional predicate to select which messages are playable
 */
export function useVoicePlayback<T extends VoicePlayableMessage>(
  messages: T[],
  sourceType: "standup" | "agent_message" = "standup",
  filter?: (msg: T) => boolean,
) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef(false);

  const stop = useCallback(() => {
    abortRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
    setLoadingId(null);
    setPlayingAll(false);
  }, []);

  const playMessage = useCallback(async (msgId: string): Promise<boolean> => {
    if (abortRef.current) return false;

    setLoadingId(msgId);
    try {
      const res = await apiFetch("/api/voice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: msgId, sourceType }),
      });

      if (!res.ok || abortRef.current) {
        setLoadingId(null);
        return false;
      }

      const data = await res.json();
      if (!data.audioUrl || abortRef.current) {
        setLoadingId(null);
        return false;
      }

      setLoadingId(null);
      setPlayingId(msgId);

      return new Promise((resolve) => {
        const audio = new Audio(data.audioUrl);
        audioRef.current = audio;
        audio.onended = () => {
          setPlayingId(null);
          audioRef.current = null;
          resolve(true);
        };
        audio.onerror = () => {
          setPlayingId(null);
          audioRef.current = null;
          resolve(false);
        };
        audio.play().catch(() => {
          setPlayingId(null);
          audioRef.current = null;
          resolve(false);
        });
      });
    } catch {
      setLoadingId(null);
      return false;
    }
  }, [sourceType]);

  const playSingle = useCallback(async (msgId: string) => {
    stop();
    abortRef.current = false;
    await playMessage(msgId);
  }, [stop, playMessage]);

  const playAll = useCallback(async () => {
    stop();
    abortRef.current = false;
    setPlayingAll(true);

    const playable = messages.filter((m) => m.id && (filter ? filter(m) : true));
    for (const msg of playable) {
      if (abortRef.current) break;
      await playMessage(msg.id!);
    }

    setPlayingAll(false);
  }, [messages, filter, stop, playMessage]);

  return { playingId, loadingId, playingAll, playSingle, playAll, stop };
}
