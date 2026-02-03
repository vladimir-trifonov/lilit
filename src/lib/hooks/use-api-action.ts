"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface UseApiActionResult<TPayload, TResult> {
  execute: (payload: TPayload) => Promise<TResult | null>;
  loading: boolean;
  error: Error | null;
}

/**
 * Wraps a single API call with loading + error state.
 * Returns the parsed JSON on success, or `null` on failure (with `error` set).
 */
export function useApiAction<TPayload = unknown, TResult = unknown>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
): UseApiActionResult<TPayload, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (payload: TPayload): Promise<TResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data as TResult;
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(wrapped);
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [url, method],
  );

  return { execute, loading, error };
}
