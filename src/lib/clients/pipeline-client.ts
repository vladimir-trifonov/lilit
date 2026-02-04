import { apiFetch } from "@/lib/utils";

export interface PipelineStatusResponse {
  status?: string;
  runId?: string;
  currentStep?: number;
  totalSteps?: number;
  userMessage?: string;
  runningCost?: number;
  createdAt?: string;
  updatedAt?: string;
  tasks?: unknown[];
  pipelineView?: unknown[];
  pastRuns?: unknown[];
  hasMorePastRuns?: boolean;
  pastRunsCursor?: string | null;
  plan?: unknown;
}

export interface PastRunResponse {
  runId: string;
  logContent: string | null;
  tasks: unknown[];
  pipelineView?: unknown[];
}

export interface LogResponse {
  log?: string;
  offset: number;
}

export interface PlanResponse {
  status?: string;
  runId?: string;
  plan?: unknown;
}

export interface QuestionResponse {
  status?: string;
  question?: string;
  context?: string;
  runId?: string;
  createdAt?: number;
}

export class PipelineClient {
  constructor(private readonly projectId: string) {}

  async getStatus(): Promise<PipelineStatusResponse> {
    const res = await apiFetch(`/api/pipeline?projectId=${this.projectId}`);
    return await res.json();
  }

  async getLogs(offset: number): Promise<LogResponse> {
    const res = await apiFetch(`/api/logs?projectId=${this.projectId}&offset=${offset}`);
    return await res.json();
  }

  async getPlan(): Promise<PlanResponse> {
    const res = await apiFetch(`/api/plan?projectId=${this.projectId}`);
    return await res.json();
  }

  async getQuestion(runId: string): Promise<QuestionResponse> {
    const res = await apiFetch(
      `/api/pipeline/question?projectId=${this.projectId}&runId=${runId}`,
    );
    return await res.json();
  }

  async abort(): Promise<Response> {
    return await apiFetch("/api/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: this.projectId }),
    });
  }

  async restart(runId: string): Promise<Response> {
    return await apiFetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: this.projectId, action: "restart", runId }),
    });
  }

  async resume(runId: string): Promise<Response> {
    return await apiFetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: this.projectId, action: "resume", runId }),
    });
  }

  async answerQuestion(runId: string, answer: string): Promise<Response> {
    return await apiFetch(`/api/pipeline/question?projectId=${this.projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, answer }),
    });
  }

  async loadMoreRuns(cursor: string | null): Promise<Response> {
    const cursorParam = cursor ? `&pastRunsCursor=${encodeURIComponent(cursor)}` : "";
    return await apiFetch(`/api/pipeline?projectId=${this.projectId}${cursorParam}`);
  }

  async getPastRun(runId: string): Promise<PastRunResponse> {
    const res = await apiFetch(`/api/pipeline/${encodeURIComponent(runId)}`);
    if (!res.ok) {
      throw new Error("fetch failed");
    }
    return await res.json();
  }
}