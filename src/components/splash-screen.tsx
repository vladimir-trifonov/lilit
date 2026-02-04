"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/utils";

const PARTICLES = Array.from({ length: 12 }, (_, i) => ({
  left: `${8 + ((i * 7 + 13) % 84)}%`,
  delay: `${(i * 1.3) % 6}s`,
  duration: `${8 + (i % 5) * 2}s`,
  size: i % 3 === 0 ? 2 : 1,
}));

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [started, setStarted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [agents, setAgents] = useState<{ name: string; role: string }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    apiFetch("/api/agents")
      .then((r) => r.json())
      .then((data: { agents: Record<string, { name: string; type: string; personality?: { codename?: string } }> }) => {
        setAgents(
          Object.values(data.agents).map((a) => ({
            name: a.personality?.codename ?? a.name,
            role: a.name,
          }))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch("/api/splash-videos")
      .then((r) => r.json())
      .then((data: { videos: string[] }) => {
        if (data.videos.length > 0) {
          const pick = data.videos[Math.floor(Math.random() * data.videos.length)];
          setVideoSrc(pick);
        } else {
          onComplete();
        }
      })
      .catch(() => onComplete());
  }, [onComplete]);

  const handleStart = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    setStarted(true);
    vid.muted = false;
    vid.play().catch(() => {
      // If unmuted play fails, try muted
      vid.muted = true;
      vid.play().catch(() => {});
    });
  }, []);

  const handleVideoEnd = useCallback(() => {
    setExiting(true);
    setTimeout(onComplete, 800);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background overflow-hidden transition-opacity duration-800 ease-out ${
        exiting ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Breathing ambient glow */}
      <div
        className="pointer-events-none absolute top-[40%] left-1/2 h-[500px] w-[800px] rounded-full bg-brand/5"
        style={{ filter: "blur(140px)", animation: "splash-glow-breathe 6s ease-in-out infinite" }}
      />
      <div
        className="pointer-events-none absolute top-[48%] left-1/2 h-[300px] w-[500px] rounded-full bg-accent/5"
        style={{ filter: "blur(100px)", animation: "splash-glow-breathe 8s ease-in-out infinite 1s" }}
      />

      {/* Floating particles */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="pointer-events-none absolute bottom-0 rounded-full bg-white/10"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animation: `splash-drift ${p.duration} linear infinite`,
            animationDelay: p.delay,
          }}
        />
      ))}

      {/* Single persistent video element — hidden before start, visible after */}
      <div
        className={`relative transition-opacity duration-500 ${
          started ? (videoReady ? "opacity-100" : "opacity-0") : "opacity-0 h-0 overflow-hidden"
        }`}
      >
        <div className="absolute -inset-1.5 rounded-2xl bg-gradient-to-r from-brand/20 via-accent/15 to-brand/20 blur-md" />
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-white/10 to-transparent" />

        {videoSrc && (
          <video
            ref={videoRef}
            src={videoSrc}
            preload="auto"
            playsInline
            onCanPlay={() => setVideoReady(true)}
            onEnded={handleVideoEnd}
            className="relative max-h-[60vh] max-w-[80vw] rounded-2xl object-contain shadow-2xl shadow-brand/10"
          />
        )}
      </div>

      {/* Gate overlay — click to start, fades out once started */}
      {!started && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center cursor-pointer select-none"
          onClick={handleStart}
        >
          {/* Title with shimmer */}
          <h1
            className="text-[2.8rem] font-semibold tracking-[0.4em] text-transparent bg-clip-text opacity-0"
            style={{
              backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.95) 40%, rgba(165,140,255,0.9) 50%, rgba(255,255,255,0.95) 60%, rgba(255,255,255,0.6) 100%)",
              backgroundSize: "200% auto",
              animation: "fade-in-up 0.5s cubic-bezier(0.4,0,0.2,1) forwards, splash-shimmer 6s linear infinite",
              animationDelay: "200ms, 1500ms",
            }}
          >
            LILIT
          </h1>

          {/* Tagline */}
          <p
            className="mt-3 text-sm font-mono uppercase tracking-[0.25em] text-white/30 opacity-0 animate-fade-in-up"
            style={{ animationDelay: "500ms" }}
          >
            your AI development crew
          </p>



          {/* Play button with pulse ring */}
          <div
            className="mt-14 flex flex-col items-center gap-3 opacity-0 animate-fade-in"
            style={{ animationDelay: "1400ms" }}
          >
            <div className="relative" style={{ animation: "splash-float 3s ease-in-out infinite" }}>
              <div
                className="absolute inset-0 rounded-full border border-brand/30"
                style={{ animation: "splash-pulse-ring 2.5s ease-out infinite" }}
              />
              <div className="h-14 w-14 rounded-full border border-white/20 bg-white/5 backdrop-blur-sm flex items-center justify-center transition-all hover:border-white/40 hover:bg-white/10 hover:scale-105">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-white/70 ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
            <span className="text-[11px] font-mono uppercase tracking-[0.25em] text-white/15">
              click to enter
            </span>
          </div>

          {/* Bottom decorative line */}
          <div
            className="absolute bottom-12 left-1/2 -translate-x-1/2 h-px w-32 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 animate-fade-in"
            style={{ animationDelay: "1600ms" }}
          />
        </div>
      )}

      {/* Title + tagline shown during video playback */}
      {started && (
        <>
          <h1
            className="mt-8 text-[2.5rem] font-semibold tracking-[0.35em] text-transparent bg-clip-text opacity-0 animate-fade-in-up"
            style={{
              backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.95) 40%, rgba(165,140,255,0.9) 50%, rgba(255,255,255,0.95) 60%, rgba(255,255,255,0.7) 100%)",
              backgroundSize: "200% auto",
              animationDelay: "400ms",
            }}
          >
            LILIT
          </h1>

          <p
            className="mt-3 text-sm font-mono uppercase tracking-[0.25em] text-white/30 opacity-0 animate-fade-in-up"
            style={{ animationDelay: "700ms" }}
          >
            your AI development crew
          </p>

          <div
            className="mt-10 h-px w-24 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 animate-fade-in"
            style={{ animationDelay: "1000ms" }}
          />
        </>
      )}
    </div>
  );
}
