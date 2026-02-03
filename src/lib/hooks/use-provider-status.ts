"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { usePolling } from "./use-polling";

interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
}

export interface UseProviderStatusResult {
  providers: ProviderStatus[] | null;
  unavailable: ProviderStatus[];
  anyAvailable: boolean;
  recheck: () => Promise<void>;
}

/**
 * Polls provider availability every 60 s with an immediate initial fetch.
 * Exposes a manual `recheck` that forces a refresh.
 */
export function useProviderStatus(): UseProviderStatusResult {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchProviders = useCallback(async (refresh = false) => {
    try {
      const url = refresh ? "/api/providers?refresh=true" : "/api/providers";
      const res = await fetch(url);
      const data = await res.json();
      if (mountedRef.current) setProviders(data.providers ?? []);
    } catch {
      // keep stale state
    }
  }, []);

  usePolling(() => fetchProviders(false), 60_000);

  const recheck = useCallback(() => fetchProviders(true), [fetchProviders]);

  const unavailable = providers?.filter((p) => !p.available) ?? [];
  const anyAvailable = providers?.some((p) => p.available) ?? false;

  return { providers, unavailable, anyAvailable, recheck };
}
