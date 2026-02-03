"use client";

import { useState, useMemo, useCallback } from "react";

export interface UseSearchResult<T> {
  query: string;
  setQuery: (query: string) => void;
  filtered: T[];
  clear: () => void;
}

/**
 * Filters an array of items by a search query using a caller-provided predicate.
 * Returns all items when the query is empty.
 */
export function useSearch<T>(
  items: T[],
  searchFn: (item: T, query: string) => boolean,
): UseSearchResult<T> {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query) return items;
    return items.filter((item) => searchFn(item, query));
    // searchFn is expected to be stable (inline arrow or useCallback from caller)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query]);

  const clear = useCallback(() => setQuery(""), []);

  return { query, setQuery, filtered, clear };
}
