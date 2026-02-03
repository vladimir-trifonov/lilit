"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePolling } from "./use-polling";
import { COST_POLL_INTERVAL_MS } from "@/lib/constants";
import { apiFetch } from "@/lib/utils";

interface CostData {
  totalCost: number;
  totalTokens: number;
  runCount: number;
  byAgent: Record<string, { cost: number; tokens: number; count: number }>;
}

export interface UseCostTrackingResult {
  costData: CostData | null;
  loading: boolean;
}

/**
 * Fetches cost data, optionally polling every 10 s when a conversationId
 * is provided (live tracking during pipeline execution).
 */
export function useCostTracking(
  projectId: string,
  conversationId?: string,
): UseCostTrackingResult {
  const [costData, setCostData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchCosts = useCallback(async () => {
    try {
      const params = conversationId
        ? `conversationId=${conversationId}`
        : `projectId=${projectId}`;
      const res = await apiFetch(`/api/costs?${params}`);
      if (res.ok && mountedRef.current) {
        setCostData(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch costs:", err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId, conversationId]);

  // Initial fetch
  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  // Live polling only when conversationId is set
  usePolling(fetchCosts, COST_POLL_INTERVAL_MS, !!conversationId);

  return { costData, loading };
}
