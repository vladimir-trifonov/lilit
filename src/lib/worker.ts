#!/usr/bin/env node
/**
 * Pipeline worker — runs as a separate Node.js process.
 * Invoked from the API route via spawn('node', ['worker.ts', ...]).
 * Writes logs to log file, results to DB.
 */
import "dotenv/config";
import fs from "fs";
import { orchestrate } from "./orchestrator";
import { clearLog, setWorkerPid } from "./claude-code";

const args = process.argv.slice(2);
const projectId = args[0];
const conversationId = args[1];
const msgFile = args[2];
const runId = args[3];
const resumeRunId = args[4]; // optional — if present, resume from this run

// Read user message from temp file and clean up
const userMessage = fs.readFileSync(msgFile, "utf-8");
try { fs.unlinkSync(msgFile); } catch {}

if (!projectId || !conversationId || !userMessage) {
  console.error("Usage: worker.ts <projectId> <conversationId> <userMessage> [runId] [resumeRunId]");
  process.exit(1);
}

async function main() {
  // Write PID for abort functionality (project-scoped)
  setWorkerPid(projectId, process.pid);

  // Only clear log on fresh runs, not on resume
  if (!resumeRunId) {
    clearLog(projectId);
  }

  try {
    const result = await orchestrate({
      projectId,
      conversationId,
      userMessage,
      runId: runId || undefined,
      resumeRunId: resumeRunId || undefined,
    });

    // Write result to stdout as JSON for the caller
    process.stdout.write(JSON.stringify({
      success: true,
      response: result.response,
      steps: result.steps,
      plan: result.plan,
      runId: result.runId ?? runId,
      standup: result.standup,
      agentMessages: result.agentMessages,
      adaptations: result.adaptations,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    process.stdout.write(JSON.stringify({
      success: false,
      error: msg,
      runId,
    }));
    process.exit(1);
  }
}

main();
