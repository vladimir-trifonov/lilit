"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface UseFetchJsonResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Fetch JSON from a URL with loading/error state management.
 * Refetches automatically when the URL changes.
 * Pass `null` to skip fetching.
 */
export function useFetchJson<T>(url: string | null): UseFetchJsonResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!url) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) {
        setData(json);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
