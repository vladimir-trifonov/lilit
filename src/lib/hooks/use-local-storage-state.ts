"use client";

import { useSyncExternalStore, useCallback, useRef } from "react";

/**
 * useState-like hook that persists to localStorage.
 *
 * Uses `useSyncExternalStore` for lint-safe, SSR-safe hydration:
 * - `getServerSnapshot` returns `defaultValue` (no window access on server).
 * - `getSnapshot` reads from localStorage on the client.
 * - `subscribe` listens for cross-tab `storage` events and same-tab writes.
 * - Every `set` call writes through to localStorage and notifies subscribers.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const defaultRef = useRef(defaultValue);
  const listenersRef = useRef(new Set<() => void>());
  // Cache the last raw string and parsed value so getSnapshot returns a stable
  // reference when the underlying data hasn't changed. Without this,
  // JSON.parse returns a new object on every call, causing useSyncExternalStore
  // to re-render infinitely.
  const cacheRef = useRef<{ raw: string | null; value: T }>({ raw: null, value: defaultValue });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      listenersRef.current.add(onStoreChange);

      // Cross-tab changes
      const handler = (e: StorageEvent) => {
        if (e.key === key) onStoreChange();
      };
      window.addEventListener("storage", handler);

      return () => {
        listenersRef.current.delete(onStoreChange);
        window.removeEventListener("storage", handler);
      };
    },
    [key],
  );

  const getSnapshot = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        if (raw === cacheRef.current.raw) return cacheRef.current.value;
        const parsed = JSON.parse(raw) as T;
        cacheRef.current = { raw, value: parsed };
        return parsed;
      }
    } catch {
      // corrupt or unavailable
    }
    return defaultRef.current;
  }, [key]);

  const getServerSnapshot = useCallback((): T => defaultRef.current, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current = getSnapshot();
      const resolved = typeof next === "function"
        ? (next as (prev: T) => T)(current)
        : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // storage full or blocked — best-effort
      }
      // Notify same-tab subscribers
      listenersRef.current.forEach((fn) => fn());
    },
    [key, getSnapshot],
  );

  return [value, set];
}
