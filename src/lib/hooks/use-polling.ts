"use client";

import { useEffect, useRef } from "react";

/**
 * Generic interval-based polling hook.
 * Fires the callback immediately, then repeats at the given interval.
 * Automatically cleans up on unmount or when `enabled` becomes false.
 *
 * The callback is stored in a ref so callers don't need to memoize it.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  interval: number,
  enabled: boolean = true,
) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  });

  useEffect(() => {
    if (!enabled || interval <= 0) return;

    savedCallback.current();

    const id = setInterval(() => {
      savedCallback.current();
    }, interval);

    return () => clearInterval(id);
  }, [interval, enabled]);
}
