"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
}

async function fetchProviderData(refresh = false): Promise<ProviderStatus[]> {
  const url = refresh ? "/api/providers?refresh=true" : "/api/providers";
  const res = await fetch(url);
  const data = await res.json();
  return data.providers ?? [];
}

export function ProviderAlert() {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const mountedRef = useRef(true);

  const recheck = useCallback(async () => {
    try {
      const data = await fetchProviderData(true);
      if (mountedRef.current) setProviders(data);
    } catch {
      // Network error -- keep showing stale state
    }
  }, []);

  // Subscribe to provider status via polling
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch + recurring poll
    const poll = async () => {
      try {
        const data = await fetchProviderData();
        if (mountedRef.current) setProviders(data);
      } catch {
        // ignore
      }
    };

    // Fire immediately, then every 60s
    const timeout = setTimeout(poll, 0);
    const interval = setInterval(poll, 60_000);

    return () => {
      mountedRef.current = false;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  // Auto-hide when at least one provider becomes available
  if (!providers || providers.some((p) => p.available)) return null;
  if (dismissed) return null;

  const unavailable = providers.filter((p) => !p.available);

  return (
    <div className="bg-amber-950/60 border-b border-amber-800/50 px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-amber-200">
            No AI providers available
          </p>
          <ul className="mt-1 space-y-0.5 text-amber-300/80">
            {unavailable.map((p) => (
              <li key={p.id}>
                {p.name}: {p.reason ?? "unavailable"}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-amber-700/50 text-amber-200 hover:bg-amber-900/50"
            onClick={() => recheck()}
          >
            Recheck
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400/70 hover:text-amber-200 hover:bg-amber-900/50"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
