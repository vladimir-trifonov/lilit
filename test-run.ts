/**
 * Direct orchestrator test — bypasses Next.js server.
 * Run with: cd ~/src/ai/crew && npx tsx test-run.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🚀 Starting Crew POC test...\n");

  // Ensure project exists
  let project = await prisma.project.findFirst({
    where: { name: "Counter App" },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        name: "Counter App",
        path: "/Users/vladimirtrifonov/src/ai/crew-test-app",
      },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { projectId: project.id },
    orderBy: { updatedAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { projectId: project.id },
    });
  }

  console.log(`📁 Project: ${project.name} (${project.path})`);
  console.log(`💬 Conversation: ${conversation.id}\n`);

  // Import orchestrator dynamically (needs compiled)
  const { orchestrate } = await import("./src/lib/orchestrator");

  const userMessage = `Build a simple counter app with Next.js. Features:
- A page that shows a counter starting at 0
- An "Increment" button that adds 1
- A "Decrement" button that subtracts 1 (minimum 0)
- A "Reset" button that sets it back to 0
- Show the count in large text, centered on the page
- Use Tailwind CSS for styling`;

  console.log("📝 User message:", userMessage.slice(0, 80) + "...\n");
  console.log("⏳ Running pipeline (PM → Dev → Review → QA)...\n");
  console.log("=".repeat(60));

  const startTime = Date.now();

  try {
    const result = await orchestrate({
      projectId: project.id,
      conversationId: conversation.id,
      userMessage,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n" + "=".repeat(60));
    console.log(`\n✅ Pipeline completed in ${elapsed}s\n`);

    console.log("📋 Steps:");
    for (const step of result.steps) {
      const who = step.role ? `${step.agent}:${step.role}` : step.agent;
      const icon = step.status === "done" ? "✅" : "❌";
      console.log(`  ${icon} ${who} — ${step.title}`);
      console.log(`     ${step.output.slice(0, 200)}...\n`);
    }

    console.log("📝 Summary:");
    console.log(result.response);

    if (result.plan) {
      console.log("\n📊 PM Plan:");
      console.log(`  Pipeline: ${result.plan.pipeline.join(" → ")}`);
      console.log(`  Tasks: ${result.plan.tasks.length}`);
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ Failed after ${elapsed}s:`, error);
  }

  // Show event log
  const events = await prisma.eventLog.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
  });

  if (events.length > 0) {
    console.log("\n📜 Event Log:");
    for (const e of events) {
      const who = e.role ? `${e.agent}:${e.role}` : e.agent;
      console.log(`  [${who}] ${e.type}`);
    }
  }

  // Show agent runs
  const runs = await prisma.agentRun.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
  });

  if (runs.length > 0) {
    console.log("\n⚡ Agent Runs:");
    for (const r of runs) {
      const who = r.role ? `${r.agent}:${r.role}` : r.agent;
      const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "?";
      console.log(`  ${r.status === "completed" ? "✅" : "❌"} ${who} (${dur}) — ${r.model}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
