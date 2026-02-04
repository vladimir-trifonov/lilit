/**
 * Pipeline step indicators component
 * Shows visual progress of agent steps with icons and status.
 * Supports both sequential (log-parsed) and task graph (DAG) rendering.
 */

"use client";

import { useMemo, useState } from "react";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import type { PipelineStep, StepStatus, DbTask, PipelineTaskView } from "@/types/pipeline";

interface PipelineStepsProps {
  steps: PipelineStep[];
  tasks?: DbTask[];
  pipelineView?: PipelineTaskView[];
  className?: string;
}

/** Agent identity colors from the design system (OKLCH) */
const AGENT_COLORS: Record<string, { dot: string; border: string; text: string }> = {
  pm:        { dot: "bg-[oklch(0.65_0.15_270)]",  border: "border-[oklch(0.65_0.15_270/0.3)]", text: "text-[oklch(0.75_0.12_270)]" },
  architect: { dot: "bg-[oklch(0.60_0.12_200)]",  border: "border-[oklch(0.60_0.12_200/0.3)]", text: "text-[oklch(0.72_0.10_200)]" },
  developer: { dot: "bg-[oklch(0.65_0.18_155)]",  border: "border-[oklch(0.65_0.18_155/0.3)]", text: "text-[oklch(0.75_0.14_155)]" },
  qa:        { dot: "bg-[oklch(0.65_0.15_45)]",   border: "border-[oklch(0.65_0.15_45/0.3)]",  text: "text-[oklch(0.75_0.12_45)]" },
};

const DEFAULT_AGENT_COLOR = { dot: "bg-muted-foreground/50", border: "border-border-subtle", text: "text-muted-foreground" };

function getAgentColor(agent: string) {
  return AGENT_COLORS[agent] ?? DEFAULT_AGENT_COLOR;
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
function isGraphMode(tasks: DbTask[], view?: PipelineTaskView[]): boolean {
  if (view && view.length > 0) return true;
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
  description: string;
  agent: string;
  role?: string;
  status: StepStatus;
  rawStatus: string;
  dependsOn: string[];
  acceptanceCriteria: string[];
  outputSummary: string | null;
  order: number;
}

/**
 * Group tasks into dependency layers for visual layout.
 *
 * Uses topological ordering by dependencies, but also respects creation order
 * (sequenceOrder) so that dynamically added tasks (e.g. fix tasks injected
 * after a review) appear after the tasks that existed when they were created,
 * not at the top of the graph.
 */
function computeLayers(tasks: GraphTask[]): GraphTask[][] {
  // Sort by creation order first so earlier tasks get assigned to earlier layers
  const sorted = [...tasks].sort((a, b) => a.order - b.order);
  const taskMap = new Map(sorted.map((t) => [t.id, t]));
  const layers: GraphTask[][] = [];
  const assigned = new Set<string>();
  const taskLayer = new Map<string, number>();

  let remaining = [...sorted];
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
      for (const t of nextRemaining) taskLayer.set(t.id, layers.length - 1);
      break;
    }

    // Sort tasks within layer by creation order for stable display
    layer.sort((a, b) => a.order - b.order);

    for (const t of layer) {
      assigned.add(t.id);
      taskLayer.set(t.id, layers.length);
    }
    layers.push(layer);
    remaining = nextRemaining;
  }

  return layers;
}

function TaskCard({ task }: { task: GraphTask }) {
  const [expanded, setExpanded] = useState(false);
  const agentLabel = task.role ? `${task.agent}:${task.role}` : task.agent;
  const isRunning = task.status === "running";
  const isSkipped = task.rawStatus === "skipped" || task.rawStatus === "cancelled";
  const isDone = task.status === "done" && !isSkipped;
  const isFailed = task.status === "failed";
  const isPending = task.status === "pending";
  const colors = getAgentColor(task.agent);

  // Container classes by status
  let cardClass = "rounded-lg border transition-all duration-300 min-w-0";
  if (isRunning) cardClass += " bg-brand-soft/40 border-brand/20";
  else if (isDone) cardClass += " bg-success-soft/30 border-success/15";
  else if (isFailed) cardClass += " bg-destructive-soft/30 border-destructive/15";
  else if (isSkipped) cardClass += " bg-muted/30 border-border-subtle opacity-50";
  else cardClass += " bg-surface/30 border-border-subtle";

  const hasDetails = task.description || task.acceptanceCriteria.length > 0 || task.outputSummary;

  return (
    <div className={cardClass}>
      {/* Header — clickable to toggle */}
      <div
        onClick={hasDetails ? () => setExpanded((v) => !v) : undefined}
        className={`flex items-start gap-2.5 py-1.5 px-2.5 ${hasDetails ? "cursor-pointer" : ""}`}
      >
        {/* Agent color dot / spinner */}
        <div className="flex items-center pt-0.5 shrink-0">
          {isRunning ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          ) : (
            <div className={`w-2.5 h-2.5 rounded-full ${
              isDone ? "bg-success/70" :
              isFailed ? "bg-destructive/70" :
              isSkipped ? "bg-muted-foreground/25" :
              colors.dot
            }`} />
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          {/* Task title */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-[11px] leading-tight ${
              isRunning ? "text-foreground font-medium" :
              isDone ? "text-foreground/80" :
              isFailed ? "text-destructive" :
              isSkipped ? "text-muted-foreground line-through" :
              "text-muted-foreground"
            }`}>
              {isRunning ? (
                <ShimmeringText text={task.title} duration={3} spread={2} className="text-[11px]" />
              ) : (
                task.title
              )}
            </span>
            {isDone && <span className="text-success text-[10px]">&#x2713;</span>}
            {isFailed && <span className="text-destructive text-[10px]">&#x2717;</span>}
          </div>

          {/* Agent label + graph ID */}
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-mono ${isPending ? "text-faint" : colors.text}`}>
              {agentLabel}
            </span>
            <span className="text-[9px] text-faint font-mono opacity-50">{task.id}</span>
          </div>
        </div>

        {/* Expand chevron */}
        {hasDetails && (
          <span className={`text-[10px] text-faint shrink-0 pt-0.5 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}>
            &#x25B8;
          </span>
        )}
      </div>

      {/* Expanded details — NOT clickable for toggle (user can select/copy) */}
      {expanded && hasDetails && (
        <div className="px-2.5 pb-2 pt-0.5 ml-[22px] border-t border-border-subtle/50 mt-0.5 space-y-1.5">
          {task.description && (
            <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {task.description}
            </p>
          )}
          {task.acceptanceCriteria.length > 0 && (
            <div>
              <span className="text-[10px] text-faint uppercase tracking-wider font-medium">Acceptance Criteria</span>
              <ul className="mt-0.5 space-y-0.5">
                {task.acceptanceCriteria.map((ac, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                    <span className="text-faint shrink-0">&#x2022;</span>
                    <span>{ac}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {task.outputSummary && (
            <div>
              <span className="text-[10px] text-faint uppercase tracking-wider font-medium">Output</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5 whitespace-pre-wrap">
                {task.outputSummary}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function viewToGraphTasks(view: PipelineTaskView[]): GraphTask[] {
  return view.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    agent: t.agent,
    role: t.role,
    status: taskStatusToStepStatus(t.status),
    rawStatus: t.status,
    dependsOn: t.dependsOn,
    acceptanceCriteria: t.acceptanceCriteria,
    outputSummary: t.outputSummary,
    order: t.order,
  }));
}

function TaskGraphView({
  tasks,
  view,
  className,
}: {
  tasks: DbTask[];
  view?: PipelineTaskView[];
  className: string;
}) {
  const graphTasks: GraphTask[] = useMemo(() => {
    if (view && view.length > 0) return viewToGraphTasks(view);
    return tasks.map((t) => ({
      id: t.graphId ?? `seq-${t.sequenceOrder}`,
      title: t.title,
      description: t.description,
      agent: t.assignedAgent ?? "unassigned",
      role: t.assignedRole ?? undefined,
      status: taskStatusToStepStatus(t.status),
      rawStatus: t.status,
      dependsOn: t.dependsOn ?? [],
      acceptanceCriteria: t.acceptanceCriteria ?? [],
      outputSummary: t.outputSummary ?? null,
      order: t.sequenceOrder,
    }));
  }, [tasks, view]);

  const layers = useMemo(() => computeLayers(graphTasks), [graphTasks]);

  const doneCount = graphTasks.filter((t) => t.status === "done").length;
  const runningCount = graphTasks.filter((t) => t.status === "running").length;
  const pendingCount = graphTasks.filter((t) => t.status === "pending").length;
  const totalCount = graphTasks.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const allPending = pendingCount === totalCount;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Header + progress bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tasks</div>
            <span className="text-[10px] text-faint font-mono">
              {doneCount}/{totalCount}
              {runningCount > 0 && (
                <span className="text-brand ml-1">
                  {runningCount} running
                </span>
              )}
              {allPending && (
                <span className="text-muted-foreground ml-1">
                  ready to start
                </span>
              )}
            </span>
          </div>
          <span className="text-[10px] text-faint font-mono">{progressPct}%</span>
        </div>
        {/* Progress bar */}
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              allPending ? "bg-muted-foreground/30" : "bg-brand"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Task graph layers */}
      <div className="flex flex-col">
        {layers.map((layer, layerIdx) => {
          const isParallel = layer.length > 1;
          const hasRunning = layer.some((t) => t.status === "running");
          const isLast = layerIdx === layers.length - 1;

          return (
            <div key={`layer-${layer[0].id}`} className="flex gap-2">
              {/* Timeline spine: dot + connector line */}
              <div className="flex flex-col items-center w-3 shrink-0 pt-2">
                <div className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-300 ${
                  hasRunning ? "bg-brand ring-2 ring-brand/25" :
                  layer.every((t) => t.status === "done") ? "bg-success/70" :
                  layer.some((t) => t.status === "failed") ? "bg-destructive/70" :
                  "bg-muted-foreground/25"
                }`} />
                {!isLast && <div className="w-px flex-1 bg-border-subtle min-h-2" />}
              </div>

              {/* Layer content */}
              <div className={`flex-1 ${!isLast ? "pb-1" : ""}`}>
                {isParallel ? (
                  <div className="border-l-2 border-brand/20 pl-2 flex flex-col gap-1 py-0.5">
                    {layer.map((task) => <TaskCard key={task.id} task={task} />)}
                  </div>
                ) : (
                  <TaskCard task={layer[0]} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function PipelineSteps({ steps, tasks, pipelineView, className = "" }: PipelineStepsProps) {
  // Prefer DB tasks when they exist (show them even in "created" state)
  const hasTasks = tasks && tasks.length > 0;

  // Use graph mode when tasks have graphId fields
  if (hasTasks && isGraphMode(tasks, pipelineView)) {
    return <TaskGraphView tasks={tasks} view={pipelineView} className={className} />;
  }

  const resolvedSteps = hasTasks ? tasksToSteps(tasks!) : steps;

  if (resolvedSteps.length === 0) return null;

  // Fallback sequential view — minimal, for edge cases without graphId
  const doneCount = resolvedSteps.filter((s) => s.status === "done").length;
  const totalCount = resolvedSteps.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pipeline</div>
        <span className="text-[10px] text-faint font-mono">{doneCount}/{totalCount}</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="flex flex-col gap-1">
        {resolvedSteps.map((step, idx) => {
          const label = step.role ? `${step.agent}:${step.role}` : step.agent;
          const status = step.status;
          const isAnimated = status === "running";
          const colors = getAgentColor(step.agent);

          return (
            <div key={`${step.agent}-${step.role}-${idx}`} className={`flex items-center gap-2 py-1 px-2 rounded-md text-[11px] ${
              isAnimated ? "bg-brand-soft/40" :
              status === "done" ? "opacity-70" :
              status === "failed" ? "bg-destructive-soft/30" :
              ""
            }`}>
              {isAnimated ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent shrink-0" />
              ) : (
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  status === "done" ? "bg-success/70" :
                  status === "failed" ? "bg-destructive/70" :
                  colors.dot
                }`} />
              )}
              {isAnimated ? (
                <ShimmeringText text={label} duration={2} spread={1.5} className="text-[11px]" />
              ) : (
                <span className={`font-mono ${colors.text}`}>{label}</span>
              )}
              {status === "done" && <span className="text-success text-[10px] ml-auto">&#x2713;</span>}
              {status === "failed" && <span className="text-destructive text-[10px] ml-auto">&#x2717;</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
