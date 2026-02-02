#!/usr/bin/env node
/**
 * Pipeline worker — runs as a separate Node.js process.
 * Invoked from the API route via spawn('node', ['worker.ts', ...]).
 * Writes logs to log file, results to DB.
 */
import "dotenv/config";
import { orchestrate } from "./orchestrator";
import { clearLog, setWorkerPid } from "./claude-code";

const args = process.argv.slice(2);
const projectId = args[0];
const conversationId = args[1];
const userMessage = args[2];

if (!projectId || !conversationId || !userMessage) {
  console.error("Usage: worker.ts <projectId> <conversationId> <userMessage>");
  process.exit(1);
}

async function main() {
  // Write PID for abort functionality
  setWorkerPid(process.pid);

  clearLog();
  try {
    const result = await orchestrate({
      projectId,
      conversationId,
      userMessage,
    });

    // Write result to stdout as JSON for the caller
    process.stdout.write(JSON.stringify({
      success: true,
      response: result.response,
      steps: result.steps,
      plan: result.plan,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    process.stdout.write(JSON.stringify({
      success: false,
      error: msg,
    }));
    process.exit(1);
  }
}

main();
