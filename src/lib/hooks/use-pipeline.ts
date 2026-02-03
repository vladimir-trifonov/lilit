"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePolling } from "./use-polling";
import { parseLogSteps } from "@/lib/log-parser";
import { DISMISSED_RUN_KEY_PREFIX } from "@/lib/constants";
import { apiFetch } from "@/lib/utils";
import type { PipelineStep, DbTask } from "@/types/pipeline";

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
  pendingPlan: { runId: string; plan: unknown } | null;
  pendingQuestion: PMQuestionData | null;
  resumableRun: ResumableRun | null;
  pipelineSteps: PipelineStep[];
  tasks: DbTask[];

  // Control
  abort: () => Promise<void>;
  resume: () => Promise<void>;
  restart: () => Promise<void>;
  dismissResumable: () => void;
  clearPendingPlan: () => void;
  answerQuestion: (answer: string) => Promise<void>;

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
  const [tasks, setTasks] = useState<DbTask[]>([]);
  const logOffsetRef = useRef(0);
  const prevLoadingRef = useRef(false);
  const runStartedAtRef = useRef(0);
  const activeRunIdRef = useRef<string | null>(null);

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

  // ---- Initial pipeline status check on mount ----
  useEffect(() => {
    let cancelled = false;

    async function checkPipelineStatus() {
      try {
        const res = await apiFetch(`/api/pipeline?projectId=${projectId}`);
        const data = await res.json();
        if (cancelled) return;

        // Hydrate DB tasks whenever the API returns them
        if (data.tasks) {
          setTasks(data.tasks);
        }

        if (data.status === "running" || data.status === "awaiting_plan") {
          setLoading(true);
          logOffsetRef.current = 0;
          activeRunIdRef.current = data.runId ?? null;

          // Hydrate existing log content so reload shows accumulated output
          try {
            const logRes = await apiFetch(`/api/logs?projectId=${projectId}&offset=0`);
            const logData = await logRes.json();
            if (!cancelled && logData.log) {
              setLogContent(logData.log);
              logOffsetRef.current = logData.offset;
            }
          } catch {
            // fall through — polling will catch up
          }

          // Hydrate pending plan from DB when status is awaiting_plan
          if (data.status === "awaiting_plan" && data.plan) {
            setPendingPlan({ runId: data.runId, plan: data.plan });
          }
        } else if (data.status === "aborted" && data.totalSteps > 0) {
          if (!isRunDismissed(data.runId)) {
            setResumableRun({
              runId: data.runId,
              currentStep: data.currentStep,
              totalSteps: data.totalSteps,
              userMessage: data.userMessage,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    checkPipelineStatus();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ---- Log polling (1.5s while loading) ----
  usePolling(
    async () => {
      try {
        const res = await apiFetch(
          `/api/logs?projectId=${projectId}&offset=${logOffsetRef.current}`,
        );
        const data = await res.json();
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
      apiFetch(`/api/logs?projectId=${projectId}&offset=${logOffsetRef.current}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.log) setLogContent((prev) => prev + data.log);
        })
        .catch(() => {});
    }
    prevLoadingRef.current = loading;
  }, [loading, projectId]);

  // ---- Pipeline status polling (3s while loading) ----
  usePolling(
    async () => {
      // Grace period: skip status checks for 5s after startRun() to let the
      // worker process create the PipelineRun record in the DB. Without this,
      // the polling sees the previous run's status (e.g. "completed") and
      // immediately kills loading before the new run has started.
      if (Date.now() - runStartedAtRef.current < 5000) return;

      try {
        const res = await apiFetch(`/api/pipeline?projectId=${projectId}`);
        const data = await res.json();
        // Keep tasks fresh during polling
        if (data.tasks) {
          setTasks(data.tasks);
        }
        if (data.runId) {
          activeRunIdRef.current = data.runId;
        }
        if (data.status && data.status !== "running" && data.status !== "awaiting_plan") {
          setLoading(false);
          setPendingPlan(null);
          setPendingQuestion(null);
          activeRunIdRef.current = null;

          // Offer resume if the pipeline was aborted mid-execution
          if (data.status === "aborted" && data.totalSteps > 0) {
            if (!isRunDismissed(data.runId)) {
              setResumableRun({
                runId: data.runId,
                currentStep: data.currentStep,
                totalSteps: data.totalSteps,
                userMessage: data.userMessage,
              });
            }
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
        const res = await apiFetch(`/api/plan?projectId=${projectId}`);
        const data = await res.json();
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
        const res = await apiFetch(
          `/api/pipeline/question?projectId=${projectId}&runId=${runId}`,
        );
        const data = await res.json();
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
      const res = await apiFetch(`/api/pipeline?projectId=${projectId}`);
      const data = await res.json();
      const active = data.status === "running" || data.status === "awaiting_plan";
      setLoading(active);
      if (data.tasks) {
        setTasks(data.tasks);
      }
      if (!active) {
        setPendingPlan(null);
      }
    } catch {
      // ignore — next poll will catch up
    }
  }, [projectId]);

  // ---- Control actions ----

  const startRun = useCallback(() => {
    setResumableRun(null);
    setLoading(true);
    setLogContent("");
    setTasks([]);
    setPendingQuestion(null);
    logOffsetRef.current = 0;
    runStartedAtRef.current = Date.now();
  }, []);

  const appendLog = useCallback((text: string) => {
    setLogContent((prev) => prev + text);
  }, []);

  const abort = useCallback(async () => {
    try {
      setAborting(true);
      const res = await apiFetch("/api/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
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
  }, [projectId]);

  const resume = useCallback(async () => {
    if (!resumableRun) return;
    startRun();

    try {
      await apiFetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "resume",
          runId: resumableRun.runId,
        }),
      });
    } catch {
      setLoading(false);
    }
  }, [resumableRun, projectId, startRun]);

  const restart = useCallback(async () => {
    if (!resumableRun) return;
    startRun();

    try {
      await apiFetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "restart",
          runId: resumableRun.runId,
        }),
      });
    } catch {
      setLoading(false);
    }
  }, [resumableRun, projectId, startRun]);

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

  const answerQuestion = useCallback(async (answer: string) => {
    if (!pendingQuestion) return;
    try {
      await apiFetch("/api/pipeline/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          runId: pendingQuestion.runId,
          answer,
        }),
      });
      setPendingQuestion(null);
    } catch (err) {
      console.error("Failed to submit answer:", err);
    }
  }, [pendingQuestion, projectId]);

  return {
    loading,
    logContent,
    currentAgent,
    pendingPlan,
    pendingQuestion,
    resumableRun,
    pipelineSteps,
    tasks,
    abort,
    resume,
    restart,
    dismissResumable,
    clearPendingPlan,
    answerQuestion,
    startRun,
    appendLog,
    refetchStatus,
  };
}
