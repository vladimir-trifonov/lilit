"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PlanTask {
  id: number;
  title: string;
  description: string;
  agent: string;
  role: string;
  acceptanceCriteria?: string[];
  provider?: string;
  model?: string;
}

interface Plan {
  analysis: string;
  needsArchitect: boolean;
  tasks: PlanTask[];
  pipeline: string[];
}

interface PlanConfirmationProps {
  runId: string;
  plan: Plan;
  onConfirmed: () => void;
  onRejected: () => void;
}

export function PlanConfirmation({ runId, plan, onConfirmed, onRejected }: PlanConfirmationProps) {
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  async function handleAction(action: "confirm" | "reject") {
    setSubmitting(true);
    try {
      await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action, notes: notes || undefined }),
      });

      if (action === "confirm") {
        onConfirmed();
      } else {
        onRejected();
      }
    } catch {
      // ignore — will be retried
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-surface border border-border/50 rounded-xl p-4 space-y-3 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Execution Plan</span>
        <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-400">
          Awaiting Approval
        </Badge>
      </div>

      {/* Analysis */}
      <p className="text-sm text-muted-foreground">{plan.analysis}</p>

      {/* Tasks */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Tasks ({plan.tasks.length}):</span>
        {plan.tasks.map((task) => (
          <div key={task.id} className="flex items-start gap-2 text-xs">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 mt-0.5">
              {task.agent}:{task.role}
            </Badge>
            <div>
              <span className="text-foreground font-medium">{task.title}</span>
              {task.provider && (
                <span className="text-muted-foreground ml-1">({task.provider}:{task.model})</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div>
        <span className="text-xs font-medium text-muted-foreground">Pipeline: </span>
        <span className="text-xs text-foreground">{plan.pipeline.join(" → ")}</span>
      </div>

      {/* Notes */}
      {showNotes && (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes for the team (optional)..."
          className="w-full bg-muted/30 border border-input rounded-md px-3 py-2 text-xs resize-none focus:ring-1 focus:ring-ring outline-none"
          rows={2}
        />
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={() => handleAction("confirm")}
          disabled={submitting}
          size="sm"
          className="text-xs"
        >
          Approve
        </Button>
        <Button
          onClick={() => handleAction("reject")}
          disabled={submitting}
          variant="destructive"
          size="sm"
          className="text-xs"
        >
          Reject
        </Button>
        {!showNotes && (
          <Button
            onClick={() => setShowNotes(true)}
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
          >
            Add Notes
          </Button>
        )}
      </div>
    </div>
  );
}
