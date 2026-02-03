/**
 * Cost display component
 * Shows real-time cost tracking during pipeline execution
 */

"use client";

import { Badge } from "@/components/ui/badge";
import { formatCost } from "@/lib/cost-calculator";
import { useCostTracking } from "@/lib/hooks/use-cost-tracking";

interface CostDisplayProps {
  projectId: string;
  conversationId?: string;
  compact?: boolean;
  className?: string;
}

export function CostDisplay({ projectId, conversationId, compact = false, className = "" }: CostDisplayProps) {
  const { costData, loading } = useCostTracking(projectId, conversationId);

  if (loading) {
    return (
      <div className={`text-[10px] text-muted-foreground font-mono ${className}`}>
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
        <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-mono bg-surface border-border-subtle text-foreground">
          💰 {formatCost(costData.totalCost)}
        </Badge>
        <span className="text-[10px] text-faint font-mono">
          {costData.totalTokens.toLocaleString()} tok
        </span>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-muted-foreground">Total Cost:</span>
        <span className="text-sm font-mono font-medium text-foreground">
          {formatCost(costData.totalCost)}
        </span>
        <span className="text-xs text-faint font-mono">
          ({costData.totalTokens.toLocaleString()} tokens, {costData.runCount} runs)
        </span>
      </div>

      {Object.keys(costData.byAgent).length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">By Agent:</div>
          <div className="grid gap-1">
            {Object.entries(costData.byAgent)
              .sort(([, a], [, b]) => b.cost - a.cost)
              .map(([agent, stats]) => (
                <div key={agent} className="flex items-center justify-between text-xs">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border-subtle text-muted-foreground">
                    {agent}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-foreground/80">
                      {formatCost(stats.cost)}
                    </span>
                    <span className="text-faint text-[10px] font-mono">
                      ({stats.tokens.toLocaleString()})
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
