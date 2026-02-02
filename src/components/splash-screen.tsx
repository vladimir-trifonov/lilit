"use client";

import { useState, useEffect, useCallback } from "react";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/splash-videos")
      .then((r) => r.json())
      .then((data: { videos: string[] }) => {
        if (data.videos.length > 0) {
          const pick = data.videos[Math.floor(Math.random() * data.videos.length)];
          setVideoSrc(pick);
        } else {
          // No videos found — skip splash
          onComplete();
        }
      })
      .catch(() => onComplete());
  }, [onComplete]);

  const handleVideoEnd = useCallback(() => {
    setExiting(true);
    setTimeout(onComplete, 700);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-700 ease-out ${
        exiting ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {videoSrc && (
        <video
          src={videoSrc}
          autoPlay
          muted
          playsInline
          onEnded={handleVideoEnd}
          className="max-h-full max-w-full object-contain"
        />
      )}
    </div>
  );
}
