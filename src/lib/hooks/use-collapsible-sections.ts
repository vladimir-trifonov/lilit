"use client";

import { useState, useCallback } from "react";

export interface UseCollapsibleSectionsResult {
  collapsed: Set<number>;
  toggle: (index: number) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/**
 * Manages a set of collapsible section indices.
 */
export function useCollapsibleSections(
  totalSections: number,
): UseCollapsibleSectionsResult {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const toggle = useCallback((index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  const collapseAll = useCallback(() => {
    setCollapsed(new Set(Array.from({ length: totalSections }, (_, i) => i)));
  }, [totalSections]);

  return { collapsed, toggle, expandAll, collapseAll };
}
