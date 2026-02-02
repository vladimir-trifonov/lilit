/**
 * Conversations API
 * GET /api/conversations?projectId=xxx - Get all conversations for a project
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  try {
    const conversations = await prisma.conversation.findMany({
      where: { projectId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 1, // Get first message for preview
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Format conversations with preview
    const formatted = conversations.map((conv) => ({
      id: conv.id,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: conv._count.messages,
      preview: conv.messages[0]?.content.slice(0, 100) || "No messages",
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error("Conversations API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}
