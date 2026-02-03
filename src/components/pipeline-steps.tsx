/**
 * Pipeline step indicators component
 * Shows visual progress of agent steps with icons and status.
 * Supports both sequential (log-parsed) and task graph (DAG) rendering.
 */

"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import type { PipelineStep, StepStatus, DbTask } from "@/types/pipeline";

interface PipelineStepsProps {
  steps: PipelineStep[];
  tasks?: DbTask[];
  className?: string;
}

/** Map DB task status to visual StepStatus */
function taskStatusToStepStatus(status: string): StepStatus {
  switch (status) {
    case "in_progress":
    case "running":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "skipped":
    case "cancelled":
      return "done"; // show as completed (greyed out via label)
    default:
      return "pending";
  }
}

/** Check if tasks have graph IDs (DAG mode) */
function isGraphMode(tasks: DbTask[]): boolean {
  return tasks.some((t) => t.graphId != null);
}

/** Convert DB tasks to PipelineSteps for sequential rendering */
function tasksToSteps(tasks: DbTask[]): PipelineStep[] {
  return tasks.map((t) => ({
    agent: t.assignedAgent ?? "unassigned",
    role: t.assignedRole ?? undefined,
    title: t.assignedRole ? `${t.assignedAgent}:${t.assignedRole}` : (t.assignedAgent ?? t.title),
    status: taskStatusToStepStatus(t.status),
    stepNumber: t.sequenceOrder + 1,
    totalSteps: tasks.length,
  }));
}

// ── Task Graph (DAG) rendering ─────────────────────────────────────────────

interface GraphTask {
  id: string;
  title: string;
  agent: string;
  role?: string;
  status: StepStatus;
  rawStatus: string;
  dependsOn: string[];
}

/** Group tasks into dependency layers (topological levels) for visual layout */
function computeLayers(tasks: GraphTask[]): GraphTask[][] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const layers: GraphTask[][] = [];
  const assigned = new Set<string>();

  // Iteratively assign tasks to layers: a task goes in the first layer
  // where all its dependencies have already been assigned.
  let remaining = [...tasks];
  while (remaining.length > 0) {
    const layer: GraphTask[] = [];
    const nextRemaining: GraphTask[] = [];

    for (const task of remaining) {
      const depsResolved = task.dependsOn.every((dep) => assigned.has(dep) || !taskMap.has(dep));
      if (depsResolved) {
        layer.push(task);
      } else {
        nextRemaining.push(task);
      }
    }

    // Safety valve: if no tasks were assignable, break to avoid infinite loop
    if (layer.length === 0) {
      layers.push(nextRemaining);
      break;
    }

    for (const t of layer) assigned.add(t.id);
    layers.push(layer);
    remaining = nextRemaining;
  }

  return layers;
}

function TaskGraphView({ tasks, className }: { tasks: DbTask[]; className: string }) {
  const graphTasks: GraphTask[] = useMemo(() =>
    tasks.map((t) => ({
      id: t.graphId ?? `seq-${t.sequenceOrder}`,
      title: t.title,
      agent: t.assignedAgent ?? "unassigned",
      role: t.assignedRole ?? undefined,
      status: taskStatusToStepStatus(t.status),
      rawStatus: t.status,
      dependsOn: t.dependsOn ?? [],
    })),
    [tasks],
  );

  const layers = useMemo(() => computeLayers(graphTasks), [graphTasks]);

  const doneCount = graphTasks.filter((t) => t.status === "done").length;
  const runningCount = graphTasks.filter((t) => t.status === "running").length;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task Graph</div>
        <span className="text-[10px] text-faint font-mono">
          {doneCount}/{graphTasks.length} done
          {runningCount > 0 && ` | ${runningCount} running`}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {layers.map((layer, layerIdx) => (
          <div key={layerIdx} className="flex flex-col gap-1.5">
            {/* Layer connector */}
            {layerIdx > 0 && (
              <div className="flex justify-center">
                <span className="text-border text-[10px]">|</span>
              </div>
            )}

            {/* Parallel tasks in this layer */}
            <div className="flex flex-wrap gap-1.5 items-center">
              {layer.length > 1 && (
                <span className="text-[9px] text-faint font-mono mr-0.5">||</span>
              )}
              {layer.map((task) => {
                const label = task.role ? `${task.agent}:${task.role}` : task.agent;
                const isAnimated = task.status === "running";
                const isSkipped = task.rawStatus === "skipped" || task.rawStatus === "cancelled";

                let badgeClass = "text-[10px] px-2 py-0.5 transition-all duration-300";
                if (isAnimated) badgeClass += " animate-pulse bg-brand-soft text-brand-foreground border-brand/20";
                else if (task.status === "done" && !isSkipped) badgeClass += " bg-success-soft text-success border-success/20";
                else if (task.status === "done" && isSkipped) badgeClass += " bg-muted text-muted-foreground border-border-subtle opacity-60";
                else if (task.status === "failed") badgeClass += " bg-destructive-soft text-destructive border-destructive/20";
                else badgeClass += " text-muted-foreground border-border-subtle";

                return (
                  <div key={task.id} className="flex items-center gap-1 group" title={task.title}>
                    {isAnimated && (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                    )}
                    <Badge variant="outline" className={`border ${badgeClass}`}>
                      <span className="mr-1 opacity-50 font-mono">{task.id}</span>
                      {!isAnimated && (
                        <span className="mr-1 opacity-70">
                          {task.status === "done" && !isSkipped ? "✓" : task.status === "failed" ? "✗" : isSkipped ? "–" : "•"}
                        </span>
                      )}
                      {isAnimated ? (
                        <ShimmeringText text={label} duration={2} spread={1.5} className="text-[10px]" />
                      ) : (
                        <span className={isSkipped ? "line-through" : ""}>{label}</span>
                      )}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function PipelineSteps({ steps, tasks, className = "" }: PipelineStepsProps) {
  // Prefer DB tasks when they have meaningful statuses (at least one assigned/in_progress/done/failed)
  const hasActiveTasks = tasks && tasks.length > 0 &&
    tasks.some((t) => t.status !== "created");

  // Use graph mode when tasks have graphId fields
  if (hasActiveTasks && isGraphMode(tasks)) {
    return <TaskGraphView tasks={tasks} className={className} />;
  }

  const resolvedSteps = hasActiveTasks ? tasksToSteps(tasks!) : steps;

  if (resolvedSteps.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pipeline Progress</div>
      <div className="flex flex-wrap gap-2 items-center">
        {resolvedSteps.map((step, idx) => {
          const label = step.role ? `${step.agent}:${step.role}` : step.agent;
          const status = step.status;
          const isAnimated = status === "running";

          let badgeClass = "text-[10px] px-2 py-0.5 transition-all duration-300";
          if (isAnimated) badgeClass += " animate-pulse bg-brand-soft text-brand-foreground border-brand/20";
          if (status === 'done') badgeClass += " bg-success-soft text-success border-success/20";
          if (status === 'failed') badgeClass += " bg-destructive-soft text-destructive border-destructive/20";
          if (status === 'pending') badgeClass += " text-muted-foreground border-border-subtle";

          return (
            <div key={idx} className="flex items-center gap-1 group">
               {isAnimated ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              ) : null}

              <Badge variant="outline" className={`border ${badgeClass}`}>
                 {!isAnimated && (
                    <span className="mr-1 opacity-70">
                       {status === 'done' ? '✓' : status === 'failed' ? '✗' : '•'}
                    </span>
                 )}
                {isAnimated ? (
                  <ShimmeringText text={label} duration={2} spread={1.5} className="text-[10px]" />
                ) : (
                  label
                )}
              </Badge>
              {idx < resolvedSteps.length - 1 && <span className="text-muted-foreground text-[10px] mx-1">&rarr;</span>}
            </div>
          );
        })}
      </div>
      {resolvedSteps.some((s) => s.stepNumber) && (
        <div className="text-[10px] text-faint font-mono mt-1">
          Step {resolvedSteps.find((s) => s.status === "running")?.stepNumber ?? resolvedSteps.filter((s) => s.status === "done").length}
          <span className="opacity-50 mx-1">/</span>
          {resolvedSteps[0]?.totalSteps ?? resolvedSteps.length}
        </div>
      )}
    </div>
  );
}
