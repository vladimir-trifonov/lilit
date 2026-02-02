/**
 * Cost display component
 * Shows real-time cost tracking during pipeline execution
 */

"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { formatCost } from "@/lib/cost-calculator";

interface CostData {
  totalCost: number;
  totalTokens: number;
  runCount: number;
  byAgent: Record<string, { cost: number; tokens: number; count: number }>;
}

interface CostDisplayProps {
  projectId: string;
  conversationId?: string;
  compact?: boolean;
  className?: string;
}

export function CostDisplay({ projectId, conversationId, compact = false, className = "" }: CostDisplayProps) {
  const [costData, setCostData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCosts = async () => {
      try {
        const params = conversationId ? `conversationId=${conversationId}` : `projectId=${projectId}`;
        const res = await fetch(`/api/costs?${params}`);
        if (res.ok) {
          const data = await res.json();
          setCostData(data);
        }
      } catch (err) {
        console.error("Failed to fetch costs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchCosts();

    // Refresh every 10 seconds if we have a conversation (live tracking)
    if (conversationId) {
      const interval = setInterval(fetchCosts, 10000);
      return () => clearInterval(interval);
    }
  }, [projectId, conversationId]);

  if (loading) {
    return (
      <div className={`text-xs text-zinc-500 ${className}`}>
        <span className="animate-pulse">Loading costs...</span>
      </div>
    );
  }

  if (!costData) {
    return null;
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-mono">
          💰 {formatCost(costData.totalCost)}
        </Badge>
        <span className="text-[10px] text-zinc-600">
          {costData.totalTokens.toLocaleString()} tokens
        </span>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-zinc-400">Total Cost:</span>
        <span className="text-sm font-mono font-medium text-zinc-200">
          {formatCost(costData.totalCost)}
        </span>
        <span className="text-xs text-zinc-600">
          ({costData.totalTokens.toLocaleString()} tokens, {costData.runCount} runs)
        </span>
      </div>

      {Object.keys(costData.byAgent).length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-zinc-500">By Agent:</div>
          <div className="grid gap-1">
            {Object.entries(costData.byAgent)
              .sort(([, a], [, b]) => b.cost - a.cost)
              .map(([agent, stats]) => (
                <div key={agent} className="flex items-center justify-between text-xs">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {agent}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-400">
                      {formatCost(stats.cost)}
                    </span>
                    <span className="text-zinc-600 text-[10px]">
                      ({stats.tokens.toLocaleString()} tok)
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
