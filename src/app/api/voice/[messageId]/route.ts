/**
 * GET /api/voice/{messageId} — serve cached TTS audio file.
 *
 * Streams the mp3 file from disk with proper Content-Type headers.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import { getAudioFilePath } from "@/lib/voice";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;

  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  // Look up the message to get projectId — try StandupMessage first, then AgentMessage
  let projectId: string | null = null;

  const standup = await prisma.standupMessage.findUnique({
    where: { id: messageId },
    select: { pipelineRun: { select: { projectId: true } } },
  });

  if (standup) {
    projectId = standup.pipelineRun.projectId;
  } else {
    const agentMsg = await prisma.agentMessage.findUnique({
      where: { id: messageId },
      select: { pipelineRun: { select: { projectId: true } } },
    });
    if (agentMsg) {
      projectId = agentMsg.pipelineRun.projectId;
    }
  }

  if (!projectId) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const filePath = getAudioFilePath(projectId, messageId);

  if (!filePath) {
    return NextResponse.json(
      { error: "Audio not generated yet — call POST /api/voice/generate first" },
      { status: 404 }
    );
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": fileBuffer.byteLength.toString(),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Audio file not available" },
      { status: 404 }
    );
  }
}
