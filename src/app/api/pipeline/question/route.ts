/**
 * PM question API — surfaces PM questions to the user during pipeline execution
 * and accepts user answers.
 *
 * GET  ?projectId=...&runId=... → pending PM question (or null)
 * POST { projectId, runId, answer } → submit user answer
 */

import { NextResponse } from "next/server";
import {
  readPMQuestion,
  writePMQuestionAnswer,
} from "@/lib/user-message-gate";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const runId = searchParams.get("runId");

  if (!projectId || !runId) {
    return NextResponse.json(
      { error: "projectId and runId are required" },
      { status: 400 },
    );
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  const question = readPMQuestion(projectId, runId);

  if (!question) {
    return NextResponse.json({ status: "none" });
  }

  return NextResponse.json({
    status: "pending",
    question: question.question,
    context: question.context,
    createdAt: question.createdAt,
  });
}

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, runId, answer } = body;

  if (!projectId || !runId || !answer) {
    return NextResponse.json(
      { error: "projectId, runId, and answer are required" },
      { status: 400 },
    );
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  writePMQuestionAnswer(projectId, runId, answer);

  return NextResponse.json({ status: "answered" });
}
