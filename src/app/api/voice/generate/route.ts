/**
 * POST /api/voice/generate — synthesize TTS audio for a message.
 *
 * Supports both StandupMessage and AgentMessage records.
 *
 * Body: { messageId: string, sourceType?: "standup" | "agent_message" }
 * Response: { audioUrl: string, durationMs: number, cached: boolean }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { synthesize, isVoiceAvailable } from "@/lib/voice";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { messageId, sourceType = "standup" } = body;

  if (!messageId) {
    return NextResponse.json(
      { error: "messageId is required" },
      { status: 400 }
    );
  }

  if (!isVoiceAvailable()) {
    return NextResponse.json(
      { error: "Voice synthesis unavailable — OPENAI_API_KEY not configured" },
      { status: 503 }
    );
  }

  let projectId: string;
  let text: string;
  let agentType: string;

  if (sourceType === "agent_message") {
    const msg = await prisma.agentMessage.findUnique({
      where: { id: messageId },
      include: { pipelineRun: { select: { projectId: true } } },
    });
    if (!msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    projectId = msg.pipelineRun.projectId;
    text = msg.content;
    agentType = msg.fromAgent;
  } else {
    const msg = await prisma.standupMessage.findUnique({
      where: { id: messageId },
      include: { pipelineRun: { select: { projectId: true } } },
    });
    if (!msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    projectId = msg.pipelineRun.projectId;
    text = msg.message;
    agentType = msg.fromAgent;
  }

  try {
    const result = await synthesize({
      projectId,
      messageId,
      text,
      agentType,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Voice synthesis failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      audioUrl: `/api/voice/${messageId}`,
      durationMs: result.durationMs,
      cached: result.cached,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Synthesis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
