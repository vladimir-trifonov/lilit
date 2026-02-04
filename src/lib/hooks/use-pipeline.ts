"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePolling } from "./use-polling";
import { parseLogSteps } from "@/lib/log-parser";
import { DISMISSED_RUN_KEY_PREFIX } from "@/lib/constants";
import { PipelineClient } from "@/lib/clients/pipeline-client";
import type { PipelineStep, DbTask, PastRun, PipelineTaskView } from "@/types/pipeline";

interface ResumableRun {
  runId: string;
  currentStep: number;
  totalSteps: number;
  userMessage: string;
}

export interface PMQuestionData {
  question: string;
  context: string;
  runId: string;
  createdAt: number;
}

export interface UsePipelineResult {
  // State
  loading: boolean;
  logContent: string;
  currentAgent: string | null;
  activeRunId: string | null;
  pendingPlan: { runId: string; plan: unknown } | null;
  pendingQuestion: PMQuestionData | null;
  resumableRun: ResumableRun | null;
  failedRun: { runId: string } | null;
  pipelineSteps: PipelineStep[];
  tasks: DbTask[];
  pipelineView?: PipelineTaskView[];
  pastRuns: PastRun[];
  hasMorePastRuns: boolean;

  // Control
  abort: () => Promise<void>;
  restart: () => Promise<void>;
  dismissResumable: () => void;
  dismissFailedRun: () => void;
  resumeFailedRun: () => Promise<void>;
  clearPendingPlan: () => void;
  answerQuestion: (answer: string) => Promise<void>;
  loadMorePastRuns: () => Promise<void>;
  expandPastRun: (runId: string) => Promise<void>;
  collapsePastRun: (runId: string) => void;

  // Used by message submit to start a new pipeline run
  startRun: () => void;
  // Append text to the log (e.g. stop/error messages)
  appendLog: (text: string) => void;
  // Re-fetch pipeline status from server (data-driven state update)
  refetchStatus: () => Promise<void>;
}

/**
 * Manages the full pipeline lifecycle: status detection, log streaming,
 * plan polling, and abort/resume/restart control.
 */
export function usePipeline(projectId: string): UsePipelineResult {
  const [loading, setLoading] = useState(false);
  const [logContent, setLogContent] = useState("");
  const [aborting, setAborting] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<{ runId: string; plan: unknown } | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PMQuestionData | null>(null);
  const [resumableRun, setResumableRun] = useState<ResumableRun | null>(null);
  const [failedRun, setFailedRun] = useState<{ runId: string } | null>(null);
  const [tasks, setTasks] = useState<DbTask[]>([]);
  const [pipelineView, setPipelineView] = useState<PipelineTaskView[] | undefined>(undefined);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pastRuns, setPastRuns] = useState<PastRun[]>([]);
  const [hasMorePastRuns, setHasMorePastRuns] = useState(false);
  const pastRunsCursorRef = useRef<string | null>(null);
  const logOffsetRef = useRef(0);
  const prevLoadingRef = useRef(false);
  const runStartedAtRef = useRef(0);
  const activeRunIdRef = useRef<string | null>(null);
  const client = useMemo(() => new PipelineClient(projectId), [projectId]);

  const pipelineSteps = useMemo(() => parseLogSteps(logContent), [logContent]);

  // Derive currentAgent from pipeline steps instead of manual setState
  const currentAgent = useMemo(() => {
    if (aborting) return "stopping...";
    const running = pipelineSteps.find((s) => s.status === "running");
    if (running) return running.title;
    return loading ? "pipeline" : null;
  }, [pipelineSteps, loading, aborting]);

  // ---- Helper: check if a run was dismissed ----
  function isRunDismissed(runId: string): boolean {
    try {
      return localStorage.getItem(DISMISSED_RUN_KEY_PREFIX + runId) === "1";
    } catch {
      return false;
    }
  }

  // ---- Helper: synthesize a PastRun entry from status response data ----
  // The API excludes the latest run from pastRuns, so when a run completes
  // we synthesize an entry to make it appear in history immediately.
  function synthesizePastRun(data: { runId?: string; status?: string; userMessage?: string; runningCost?: number; createdAt?: string; updatedAt?: string; tasks?: unknown[] }): PastRun {
    return {
      runId: data.runId ?? "",
      status: data.status ?? "completed",
      userMessage: data.userMessage ?? "",
      runningCost: data.runningCost ?? 0,
      createdAt: data.createdAt ?? new Date().toISOString(),
      updatedAt: data.updatedAt ?? new Date().toISOString(),
      taskCount: (data.tasks ?? []).length,
    };
  }

  // ---- Initial pipeline status check on mount ----
  useEffect(() => {
    let cancelled = false;

    async function checkPipelineStatus() {
      try {
        const data = await client.getStatus();
        if (cancelled) return;

        // Hydrate DB tasks and past runs whenever the API returns them
        if (data.tasks) {
          setTasks(data.tasks);
        }
        if (data.pipelineView) {
          setPipelineView(data.pipelineView as PipelineTaskView[]);
        }
        if (data.pastRuns) {
          setPastRuns(data.pastRuns);
          setHasMorePastRuns(data.hasMorePastRuns ?? false);
          pastRunsCursorRef.current = data.pastRunsCursor ?? null;
        }

        // Hydrate log content from disk for any status that had a run
        if (data.status && data.status !== "none") {
          try {
            const logData = await client.getLogs(0);
            if (!cancelled && logData.log) {
              setLogContent(logData.log);
              logOffsetRef.current = logData.offset;
            }
          } catch {
            // fall through — polling will catch up
          }
        }

        if (data.status === "running" || data.status === "awaiting_plan") {
          setLoading(true);
          logOffsetRef.current = logOffsetRef.current || 0;
          activeRunIdRef.current = data.runId ?? null;
          setActiveRunId(data.runId ?? null);

          // Hydrate pending plan from DB when status is awaiting_plan
          if (data.status === "awaiting_plan" && data.plan) {
            setPendingPlan({ runId: data.runId, plan: data.plan });
          }
        } else if (data.status === "aborted") {
          if (!isRunDismissed(data.runId)) {
            setResumableRun({
              runId: data.runId,
              currentStep: data.currentStep,
              totalSteps: data.totalSteps,
              userMessage: data.userMessage,
            });
          }
        } else if (data.status === "failed") {
          if (!isRunDismissed(data.runId)) {
            setFailedRun({ runId: data.runId });
          } else {
            // Dismissed failed run — add to history since the API excludes the latest run
            setPastRuns((prev) => [synthesizePastRun(data), ...prev]);
          }
        } else if (data.status === "completed") {
          // Completed run — add to history since the API excludes the latest run
          setPastRuns((prev) => [synthesizePastRun(data), ...prev]);
          setTasks([]);
          setPipelineView(undefined);
        }
      } catch {
        // ignore
      }
    }

    checkPipelineStatus();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // ---- Log polling (1.5s while loading) ----
  usePolling(
    async () => {
      // Grace period: skip log fetches for 5s after startRun() to let the
      // worker process start and call clearLog(). Without this, the polling
      // re-fetches the previous run's log file before it is cleared.
      if (Date.now() - runStartedAtRef.current < 5000) return;

      try {
        const data = await client.getLogs(logOffsetRef.current);
        if (data.log) {
          setLogContent((prev) => prev + data.log);
          logOffsetRef.current = data.offset;
        }
      } catch {
        // ignore
      }
    },
    1500,
    loading,
  );

  // ---- Final log fetch when loading transitions off ----
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      client.getLogs(logOffsetRef.current)
        .then((data) => {
          if (data.log) setLogContent((prev) => prev + data.log);
        })
        .catch(() => {});
    }
    prevLoadingRef.current = loading;
  }, [loading, client]);

  // ---- Pipeline status polling (3s while loading) ----
  usePolling(
    async () => {
      // Grace period: skip status checks for 5s after startRun() to let the
      // worker process create the PipelineRun record in the DB. Without this,
      // the polling sees the previous run's status (e.g. "completed") and
      // immediately kills loading before the new run has started.
      if (Date.now() - runStartedAtRef.current < 5000) return;

      try {
        const data = await client.getStatus();
        // Keep tasks fresh during polling
        if (data.tasks) {
          setTasks(data.tasks);
        }
        if (data.pipelineView) {
          setPipelineView(data.pipelineView as PipelineTaskView[]);
        }
        if (data.runId) {
          activeRunIdRef.current = data.runId;
          setActiveRunId(data.runId);
        }
        if (data.status && data.status !== "running" && data.status !== "awaiting_plan") {
          setLoading(false);
          setPendingPlan(null);
          setPendingQuestion(null);
          activeRunIdRef.current = null;
          setActiveRunId(null);

          if (data.status === "aborted") {
            if (!isRunDismissed(data.runId)) {
              setResumableRun({
                runId: data.runId,
                currentStep: data.currentStep,
                totalSteps: data.totalSteps,
                userMessage: data.userMessage,
              });
            }
          } else if (data.status === "failed") {
            // Keep pipeline visible with failure state
            setFailedRun({ runId: data.runId });
          } else if (data.status === "completed") {
            // Move to history immediately — synthesize entry since API excludes the latest run
            const apiPastRuns = (data.pastRuns ?? []) as PastRun[];
            setPastRuns([synthesizePastRun(data), ...apiPastRuns]);
            if (data.hasMorePastRuns !== undefined) setHasMorePastRuns(data.hasMorePastRuns);
            if (data.pastRunsCursor !== undefined) pastRunsCursorRef.current = data.pastRunsCursor;
            setTasks([]);
            setPipelineView(undefined);
          }
        }
      } catch {
        // ignore
      }
    },
    3000,
    loading,
  );

  // ---- Plan polling (2s while loading) ----
  usePolling(
    async () => {
      try {
        const data = await client.getPlan();
        if (data.status === "pending" && data.plan) {
          setPendingPlan({ runId: data.runId, plan: data.plan });
        } else {
          setPendingPlan(null);
        }
      } catch {
        // ignore
      }
    },
    2000,
    loading,
  );

  // ---- PM question polling (3s while loading) ----
  usePolling(
    async () => {
      const runId = activeRunIdRef.current;
      if (!runId) return;
      try {
        const data = await client.getQuestion(runId);
        if (data.status === "pending" && data.question) {
          setPendingQuestion({
            question: data.question,
            context: data.context,
            runId,
            createdAt: data.createdAt,
          });
        } else {
          setPendingQuestion(null);
        }
      } catch {
        // ignore
      }
    },
    3000,
    loading,
  );

  // ---- Data-driven status refresh ----

  const refetchStatus = useCallback(async () => {
    try {
      const data = await client.getStatus();
      const active = data.status === "running" || data.status === "awaiting_plan";
      setLoading(active);
      if (data.tasks) {
        setTasks(data.tasks);
      }
      if (data.pipelineView) {
        setPipelineView(data.pipelineView as PipelineTaskView[]);
      }
      if (!active) {
        setPendingPlan(null);
      }
    } catch {
      // ignore — next poll will catch up
    }
  }, [client]);

  // ---- Control actions ----

  const startRun = () => {
    setResumableRun(null);
    setFailedRun(null);
    setLoading(true);
    setLogContent("");
    setTasks([]);
    setPipelineView(undefined);
    setPendingQuestion(null);
    logOffsetRef.current = 0;
    runStartedAtRef.current = Date.now();
  };

  const appendLog = (text: string) => {
    setLogContent((prev) => prev + text);
  };

  const abort = useCallback(async () => {
    try {
      setAborting(true);
      const res = await client.abort();
      const data = await res.json();
      if (data.aborted) {
        // Use the same marker the log parser recognises to mark steps as failed
        setLogContent((prev) => prev + "\n\n🛑 PIPELINE ABORTED\n🛑 Pipeline stopped.\n");
        setPendingPlan(null);
        setLoading(false);

        // Populate resumable run so the user can continue later
        if (data.run && data.run.totalSteps > 0) {
          setResumableRun({
            runId: data.run.runId,
            currentStep: data.run.currentStep,
            totalSteps: data.run.totalSteps,
            userMessage: data.run.userMessage,
          });
        }
      }
    } catch (err) {
      console.error("Abort failed:", err);
      setLogContent((prev) => prev + "\n\n❌ Failed to send stop signal\n");
    } finally {
      setAborting(false);
    }
  }, [client]);

  const restart = useCallback(async () => {
    if (!resumableRun) return;

    // Resume: keep existing log content, don't reset offset
    setLoading(true);
    setResumableRun(null);
    setPendingQuestion(null);
    runStartedAtRef.current = Date.now();

    try {
      await client.resume(resumableRun.runId);
    } catch {
      setLoading(false);
    }
  }, [resumableRun, client]);

  const dismissResumable = useCallback(() => {
    if (resumableRun) {
      try {
        localStorage.setItem(DISMISSED_RUN_KEY_PREFIX + resumableRun.runId, "1");
      } catch {
        // best-effort
      }
    }
    setResumableRun(null);
  }, [resumableRun]);

  const clearPendingPlan = useCallback(() => setPendingPlan(null), []);

  const dismissFailedRun = useCallback(() => {
    if (failedRun) {
      try {
        localStorage.setItem(DISMISSED_RUN_KEY_PREFIX + failedRun.runId, "1");
      } catch {
        // best-effort
      }
      // Move the failed run into history
      setPastRuns((prev) => {
        if (prev.some((r) => r.runId === failedRun.runId)) return prev;
        return [{ runId: failedRun.runId, status: "failed", userMessage: "", runningCost: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskCount: tasks.length }, ...prev];
      });
    }
    setFailedRun(null);
    setTasks([]);
    setPipelineView(undefined);
  }, [failedRun, tasks.length]);

  const resumeFailedRun = useCallback(async () => {
    if (!failedRun) return;
    const runId = failedRun.runId;
    setLoading(true);
    setFailedRun(null);
    setPendingQuestion(null);
    runStartedAtRef.current = Date.now();
    try {
      await client.resume(runId);
    } catch {
      setLoading(false);
      setFailedRun({ runId });
    }
  }, [failedRun, client]);

  const loadMorePastRuns = useCallback(async () => {
    if (!hasMorePastRuns || !pastRunsCursorRef.current) return;
    try {
      const res = await client.loadMoreRuns(pastRunsCursorRef.current);
      if (!res.ok) return;
      const data = await res.json();
      if (data.pastRuns) {
        setPastRuns((prev) => [...prev, ...data.pastRuns]);
        setHasMorePastRuns(data.hasMorePastRuns ?? false);
        pastRunsCursorRef.current = data.pastRunsCursor ?? null;
      }
    } catch {
      // ignore
    }
  }, [client, hasMorePastRuns]);

  const expandPastRun = useCallback(async (runId: string) => {
    // Mark as loading
    setPastRuns((prev) =>
      prev.map((r) => (r.runId === runId ? { ...r, loading: true, expanded: true } : r)),
    );
    try {
      const data = await client.getPastRun(runId);
      setPastRuns((prev) =>
        prev.map((r) =>
          r.runId === runId
            ? {
                ...r,
                logContent: data.logContent,
                tasks: data.tasks,
                pipelineView: data.pipelineView,
                loading: false,
                expanded: true,
              }
            : r,
        ),
      );
    } catch {
      // Collapse back on error so user can retry
      setPastRuns((prev) =>
        prev.map((r) => (r.runId === runId ? { ...r, loading: false, expanded: false } : r)),
      );
    }
  }, [client]);

  const collapsePastRun = (runId: string) => {
    setPastRuns((prev) =>
      prev.map((r) => (r.runId === runId ? { ...r, expanded: false } : r)),
    );
  };

  const answerQuestion = useCallback(async (answer: string) => {
    if (!pendingQuestion) return;
    try {
      await client.answerQuestion(pendingQuestion.runId, answer);
      setPendingQuestion(null);
    } catch (err) {
      console.error("Failed to submit answer:", err);
    }
  }, [pendingQuestion, client]);

  return {
    loading,
    logContent,
    currentAgent,
    activeRunId,
    pendingPlan,
    pendingQuestion,
    resumableRun,
    failedRun,
    pipelineSteps,
    tasks,
    pipelineView,
    pastRuns,
    hasMorePastRuns,
    abort,
    restart,
    dismissResumable,
    dismissFailedRun,
    resumeFailedRun,
    clearPendingPlan,
    answerQuestion,
    loadMorePastRuns,
    expandPastRun,
    collapsePastRun,
    startRun,
    appendLog,
    refetchStatus,
  };
}
