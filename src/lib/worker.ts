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
import { prisma } from "./prisma";
import { WORKER_HEARTBEAT_INTERVAL_MS } from "./constants";

const args = process.argv.slice(2);
const resumeFlag = args.includes("--resume");
const positionalArgs = args.filter((a) => a !== "--resume");
const projectId = positionalArgs[0];
const conversationId = positionalArgs[1];
const msgFile = positionalArgs[2];
const runId = positionalArgs[3];

// Read user message from temp file and clean up
const userMessage = fs.readFileSync(msgFile, "utf-8");
try { fs.unlinkSync(msgFile); } catch {}

if (!projectId || !conversationId || !userMessage) {
  console.error("Usage: worker.ts <projectId> <conversationId> <userMessage> [runId] [--resume]");
  process.exit(1);
}

async function main() {
  // Write PID for abort functionality (project-scoped)
  setWorkerPid(projectId, process.pid);

  if (!resumeFlag) {
    clearLog(projectId);
  }

  // ── Heartbeat: update DB timestamp so the API can detect dead workers ──
  const writeHeartbeat = async () => {
    try {
      if (runId) {
        await prisma.pipelineRun.updateMany({
          where: { runId, status: { in: ["running", "awaiting_plan"] } },
          data: { heartbeatAt: new Date() },
        });
      }
    } catch {}
  };

  await writeHeartbeat();
  const heartbeatTimer = setInterval(writeHeartbeat, WORKER_HEARTBEAT_INTERVAL_MS);

  try {
    const result = await orchestrate({
      projectId,
      conversationId,
      userMessage,
      runId: runId || undefined,
      resume: resumeFlag,
    });

    clearInterval(heartbeatTimer);

    // Write result to stdout as JSON for the caller
    process.stdout.write(JSON.stringify({
      success: true,
      response: result.response,
      steps: result.steps,
      plan: result.plan,
      runId: result.runId ?? runId,
      standup: result.standup,
      agentMessages: result.agentMessages,
    }));
  } catch (err) {
    clearInterval(heartbeatTimer);

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
