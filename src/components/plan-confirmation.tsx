"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApiAction } from "@/lib/hooks/use-api-action";

/** Agent identity colors from the design system (OKLCH) — matches pipeline-steps.tsx */
const AGENT_COLORS: Record<string, { dot: string; text: string }> = {
  pm:        { dot: "bg-[oklch(0.65_0.15_270)]",  text: "text-[oklch(0.75_0.12_270)]" },
  architect: { dot: "bg-[oklch(0.60_0.12_200)]",  text: "text-[oklch(0.72_0.10_200)]" },
  developer: { dot: "bg-[oklch(0.65_0.18_155)]",  text: "text-[oklch(0.75_0.14_155)]" },
  qa:        { dot: "bg-[oklch(0.65_0.15_45)]",   text: "text-[oklch(0.75_0.12_45)]" },
};

const DEFAULT_AGENT_COLOR = { dot: "bg-muted-foreground/50", text: "text-muted-foreground" };

function getAgentColor(agent: string) {
  return AGENT_COLORS[agent] ?? DEFAULT_AGENT_COLOR;
}

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
  tasks: PlanTask[];
  pipeline: string[];
}

interface PlanConfirmationProps {
  projectId: string;
  runId: string;
  plan: Plan;
  onConfirmed: () => void;
  onRejected: () => void;
}

export function PlanConfirmation({ projectId, runId, plan, onConfirmed, onRejected }: PlanConfirmationProps) {
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const { execute, loading: submitting } = useApiAction<
    { projectId: string; runId: string; action: string; notes?: string },
    unknown
  >("/api/plan");

  async function handleAction(action: "confirm" | "reject") {
    const result = await execute({ projectId, runId, action, notes: notes || undefined });
    if (result !== null) {
      if (action === "confirm") onConfirmed();
      else onRejected();
    }
  }

  return (
    <div className="glass-raised border border-border/50 rounded-xl p-5 space-y-4 animate-fade-in-up shadow-lg my-4 relative overflow-hidden">
      {/* Glow effect */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-brand/5 blur-3xl pointer-events-none -z-10" />

      <div className="flex items-center gap-3 border-b border-border-subtle pb-3">
        <div className="h-8 w-8 rounded-full bg-brand/10 flex items-center justify-center text-brand border border-brand/20">
          📋
        </div>
        <div>
           <h3 className="text-sm font-medium text-foreground">Execution Plan Proposed</h3>
           <p className="text-[10px] text-muted-foreground">Review the agent&apos;s proposed plan before proceeding</p>
        </div>
        <Badge variant="outline" className="ml-auto text-[10px] border-warning/50 text-warning bg-warning-soft/10 animate-pulse">
          Awaiting Approval
        </Badge>
      </div>

      {/* Analysis */}
      <div className="text-xs text-muted-foreground bg-surface/50 p-3 rounded-lg border border-border-subtle leading-relaxed">
         {plan.analysis}
      </div>

      {/* Tasks */}
      <div className="space-y-2">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Proposed Tasks ({plan.tasks.length})</label>
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {plan.tasks.map((task) => {
            const colors = getAgentColor(task.agent);
            return (
            <div key={task.id} className="flex items-start gap-2.5 p-3 bg-surface/30 rounded-lg border border-border-subtle hover:bg-surface/50 transition-colors">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${colors.dot}`} />
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                   <span className="text-xs font-medium text-foreground">{task.title}</span>
                   {task.provider && (
                    <span className="text-[9px] text-faint ml-auto font-mono opacity-60">
                       {task.provider}/{task.model}
                    </span>
                   )}
                </div>
                <span className={`text-[10px] font-mono ${colors.text}`}>{task.agent}:{task.role}</span>
                {task.description && (
                  <p className="text-[10px] text-muted-foreground line-clamp-2">{task.description}</p>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline */}
      <div>
         <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Execution Flow</label>
         <div className="flex items-center gap-1.5 overflow-x-auto pb-2 flex-wrap">
            {plan.pipeline.map((step, i) => {
               const agent = step.split(":")[0];
               const colors = getAgentColor(agent);
               return (
                  <div key={i} className="flex items-center gap-1.5 shrink-0">
                     <div className="flex items-center gap-1.5 py-1 px-2 rounded-md bg-surface/30 border border-border-subtle">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                        <span className={`text-[11px] font-mono ${colors.text}`}>{step}</span>
                     </div>
                     {i < plan.pipeline.length - 1 && <span className="text-muted-foreground/30 text-[10px]">➜</span>}
                  </div>
               );
            })}
         </div>
      </div>

      {/* Notes */}
      {showNotes && (
        <div className="animate-fade-in-up">
           <textarea
             value={notes}
             onChange={(e) => setNotes(e.target.value)}
             placeholder="Add notes or feedback for the team (optional)..."
             className="w-full bg-surface border border-input rounded-lg px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none transition-all placeholder:text-muted-foreground/40"
             rows={2}
           />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
        {!showNotes && (
          <Button
            onClick={() => setShowNotes(true)}
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground mr-auto hover:text-foreground"
          >
            + Add Notes
          </Button>
        )}

        <div className={`flex items-center gap-2 ${showNotes ? 'w-full justify-end' : ''}`}>
           <Button
             onClick={() => handleAction("reject")}
             disabled={submitting}
             variant="ghost"
             size="sm"
             className="text-xs text-destructive hover:bg-destructive-soft hover:text-destructive"
           >
             Reject Plan
           </Button>
           <Button
             onClick={() => handleAction("confirm")}
             disabled={submitting}
             size="sm"
             className="text-xs shadow-md shadow-brand/20"
           >
             {submitting ? "Approving..." : "Approve Plan"}
           </Button>
        </div>
      </div>
    </div>
  );
}
